# Encrypted backups

Background: SPEC section 5 (Backups), ADR 003 (the read-only `backup_<schema>` role) and `packages/db/README.md`. The Supabase free plan has no point-in-time restore, so a scheduled job dumps one schema, encrypts it and stores it away from the app.

## Retention

This follows SPEC section 5: a **daily** job in the private repo uploads the encrypted dump as a private Actions artifact with `retention-days: 30`. It is **never committed** to any repo, so old backups (and deleted accounts) expire with the artifact. The files are encrypted with a public key; the age private key is the only thing that can read them.

## What you need

- `age` (public-key file encryption) and a Postgres client matching the server's major version, on your computer for the key and the drill, and on the runner for the job.
- The password of the `backup_<schema>` login, set with `set-passwords` (see `docs/setup/database.md`).

## Step by step

### 1. Create the private repo

Create a **private** GitHub repo, for example `skillstack-private`, with no template files. Do not put anything else secret in it that you would not want next to the backups. Real data and real keys never go in the public Skillstack repo.

### 2. Generate the age key pair (on your computer)

```bash
age-keygen -o skillstack-backup.key     # prints the public key (age1...) to the terminal
```

- The file `skillstack-backup.key` holds the **private key** (`AGE-SECRET-KEY-...`). Store it **offline in your password manager** (as a secure note or attachment), then delete the local file. Never put it in GitHub, in a secret, in the public repo or in the private repo.
- Keep a second copy somewhere independent (for example a printed copy or a second password manager entry). Without the private key every backup is unreadable.
- The **public** key (the `age1...` line) is safe to store as a secret or variable.

### 3. Add secrets to the private repo

Repo settings, Secrets and variables, Actions, new repository secrets:

| Name                  | Value                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `BACKUP_DATABASE_URL` | Connection string for the login `backup_prod` (the read-only role, not the admin). Needs check: direct connection or session pooler, see below. |
| `AGE_RECIPIENT`       | The public key, `age1...`. The script refuses a value starting with `AGE-SECRET-KEY`.                                                       |

Do not add the private key here.

### 4. Add the workflow

Create `.github/workflows/backup.yml` in the **private** repo. Replace `<owner>` and pin `PUBLIC_REF` to a reviewed tag or full commit SHA of the public repo (do not use a branch name: a moving ref would let a change run with your database secret without you reviewing it).

```yaml
name: backup

on:
  schedule:
    - cron: '17 3 * * *' # daily, 03:17 UTC
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: backup
  cancel-in-progress: false

env:
  PUBLIC_REPO: <owner>/skillstack
  PUBLIC_REF: <tag-or-full-commit-sha> # pin this
  SCHEMA: prod

jobs:
  backup:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Check out the backup script from the public repo
        uses: actions/checkout@v4 # needs check: pin to a full commit SHA
        with:
          repository: ${{ env.PUBLIC_REPO }}
          ref: ${{ env.PUBLIC_REF }}
          path: skillstack-public
          persist-credentials: false

      - name: Install age and the Postgres client
        run: |
          sudo apt-get update
          sudo apt-get install -y age
          # Needs check: the pg_dump major version must be >= the server's. Install the matching
          # postgresql-client-NN (from the PGDG apt repo if the runner image does not have it).
          pg_dump --version

      - name: Dump and encrypt
        env:
          BACKUP_DATABASE_URL: ${{ secrets.BACKUP_DATABASE_URL }}
          AGE_RECIPIENT: ${{ secrets.AGE_RECIPIENT }}
        run: |
          bash skillstack-public/packages/db/scripts/backup.sh --schema "$SCHEMA" --out-dir backups

      - name: Upload the encrypted file as a private artifact
        uses: actions/upload-artifact@v4 # needs check: pin to a full commit SHA
        with:
          name: ${{ env.SCHEMA }}-backup
          path: backups/*.dump.age
          retention-days: 30
          if-no-files-found: error
```

Notes:

- The only output is the encrypted `.dump.age` file as an Actions artifact kept 30 days. Nothing is committed or pushed. Artifacts of a private repo are visible only to people with access to it.
- GitHub masks secrets in logs, and the script never prints the connection string. Do not add `set -x` or `echo` of secrets.
- GitHub disables scheduled workflows in a repo after 60 days without repo activity, and this job makes no commits. Check from time to time that new artifacts appear, and re-enable the workflow if needed. Needs check against GitHub's current docs.
- Needs check: free-plan limits on private-repo Actions minutes and artifact storage (30 daily dumps are kept at once).

### Connection string: pooler or direct

Needs check. `pg_dump` uses session-level features and long transactions, so it is expected to work on a **direct** connection or the **session-mode** pooler, and not through the **transaction-mode** pooler. Also needs check: whether the direct connection host needs IPv6 (GitHub-hosted runners may not have it), and which username form the pooler needs for custom roles (`backup_prod.<project-ref>`, see ADR 003). Test with the `rnd` schema first.

### pg_dump version

Needs check. `pg_dump` refuses to dump a server with a newer major version than itself. Find the Supabase server version (`select version();`) and install the same or a newer `postgresql-client` on the runner. The local tests use PostgreSQL 16 only.

## What the scripts do

- `packages/db/scripts/backup.sh --schema prod|rnd [--out-dir DIR]`: requires `BACKUP_DATABASE_URL` and `AGE_RECIPIENT`. Runs `pg_dump --schema=<schema> --no-owner --no-privileges --format=custom --enable-row-security` and pipes it into `age -r`, so the dump is never on disk unencrypted. Writes `<schema>-<UTC timestamp>.dump.age`. It refuses a missing or unknown schema, and a recipient that looks like a private key. `--enable-row-security` is needed because `backup_<schema>` has no `BYPASSRLS` and `pg_dump` otherwise turns row security off, which fails on any table with RLS.
- `packages/db/scripts/restore.sh --schema prod|rnd --file FILE --i-know-this-is-a-scratch-database`: requires `AGE_IDENTITY_FILE` and `RESTORE_DATABASE_URL`. Creates the empty schema (fails if it exists), decrypts and pipes into `pg_restore`. It refuses to run without the flag, and if the restore URL equals `BACKUP_DATABASE_URL`.
- `packages/db/scripts/test-backup.sh`: local round trip against the throwaway Postgres with a temporary age key (deleted afterwards).

## Restore drill

Do this once on `rnd` before relying on the backups, and again after any change to the scripts or the Supabase plan. SPEC section 9 expects the backup action and restore script to be proven.

- [ ] Run the workflow manually (`workflow_dispatch`) with `SCHEMA` set to `rnd` and confirm the run succeeds and an `rnd-backup` artifact appears.
- [ ] Download the artifact (zip) from the run page and unzip it.
- [ ] Check the file is encrypted: `head -c 20 file` shows no `PGDMP`.
- [ ] Get the private key from the password manager into a temporary file outside any repo (`chmod 600`).
- [ ] Create a scratch database that is **not** the live one (a local Postgres, or a throwaway Supabase project). Create the roles named in the policies (`backup_rnd`, `app_rnd_user`) first if you want a clean restore; otherwise `pg_restore` reports errors for those policy statements.
- [ ] Run `restore.sh --schema rnd --file <file> --i-know-this-is-a-scratch-database` with `RESTORE_DATABASE_URL` pointing at the scratch database.
- [ ] Compare row counts of every table with the source (at least `schema_migrations` and the user tables once they exist) and spot-check one recent row.
- [ ] Check RLS is enabled on every restored table and the policies exist.
- [ ] Delete the temporary key file and the scratch database. Write down the date, the file name and the result.
- [ ] Repeat for `prod` the first time it holds data, restoring only into a scratch database.

If a step fails, the backup is not trustworthy: fix it before the next release.

## Needs check (collected)

- Supabase pooler vs direct connection for `pg_dump`, and IPv6 on GitHub-hosted runners.
- `pg_dump` major version vs the Supabase server version; availability of `age` and the right `postgresql-client` on `ubuntu-latest`.
- Whether `backup_<schema>` can read everything `pg_dump` needs on Supabase (sequences, extensions in other schemas are not dumped with `--schema`).
- GitHub's current rules for scheduled workflows in inactive repos, and private-repo Actions minutes and storage on the free plan.
- Pinning `actions/checkout` to a full commit SHA.
