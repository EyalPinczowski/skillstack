import type { Database, UserContext, UserRow } from '../../db/database';
import { unconfiguredAuthAdmin, type AuthAdmin } from './auth-admin';
import { CURRENT_LEGAL_VERSIONS, LEGAL_DOCUMENTS, type LegalDocument } from './legal';

export interface MeView {
  id: string;
  email: string;
  displayName: string | null;
  role: 'user' | 'admin';
  createdAt: string;
  lastSeenAt: string | null;
  legal: {
    terms: { currentVersion: string; accepted: boolean };
    privacy: { currentVersion: string; accepted: boolean };
    allAccepted: boolean;
  };
}

async function legalStatus(ctx: UserContext, userId: string) {
  const { rows } = await ctx.client.query<{ document: LegalDocument; version: string }>(
    `select document, version from ${ctx.schema}.legal_acceptances where user_id = $1`,
    [userId],
  );
  const accepted = (doc: LegalDocument) =>
    rows.some((r) => r.document === doc && r.version === CURRENT_LEGAL_VERSIONS[doc]);
  const status = (doc: LegalDocument) => ({
    currentVersion: CURRENT_LEGAL_VERSIONS[doc],
    accepted: accepted(doc),
  });
  return {
    terms: status('terms'),
    privacy: status('privacy'),
    allAccepted: LEGAL_DOCUMENTS.every(accepted),
  };
}

async function toMe(ctx: UserContext, user: UserRow): Promise<MeView> {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    createdAt: user.created_at.toISOString(),
    lastSeenAt: user.last_seen_at?.toISOString() ?? null,
    legal: await legalStatus(ctx, user.id),
  };
}

/** Account operations. Every query runs inside db.withUser, so row-level security applies. */
export function createAccountService(db: Database, authAdmin: AuthAdmin = unconfiguredAuthAdmin) {
  return {
    /** First call creates the profile (allowlist and cap are enforced in the database). */
    provision: (userId: string, email: string | null) => db.provision(userId, email ?? ''),

    getMe: (userId: string) =>
      db.withUser(userId, async (ctx) => {
        const { rows } = await ctx.client.query<UserRow>(
          `update ${ctx.schema}.app_users set last_seen_at = now() where id = $1 returning *`,
          [userId],
        );
        return toMe(ctx, rows[0]!);
      }),

    updateDisplayName: (userId: string, displayName: string | null) =>
      db.withUser(userId, async (ctx) => {
        const { rows } = await ctx.client.query<UserRow>(
          `update ${ctx.schema}.app_users set display_name = $2 where id = $1 returning *`,
          [userId, displayName],
        );
        return toMe(ctx, rows[0]!);
      }),

    /** Idempotent: accepting the same version twice keeps the first acceptance time. */
    acceptLegal: (userId: string, document: LegalDocument, version: string) =>
      db.withUser(userId, async (ctx) => {
        await ctx.client.query(
          `insert into ${ctx.schema}.legal_acceptances (user_id, document, version)
           values ($1, $2, $3) on conflict do nothing`,
          [userId, document, version],
        );
        const { rows } = await ctx.client.query<UserRow>(
          `select * from ${ctx.schema}.app_users where id = $1`,
          [userId],
        );
        return toMe(ctx, rows[0]!);
      }),

    /** Everything the account holds. Table names are fixed here; none comes from a request. */
    exportData: (userId: string) =>
      db.withUser(userId, async (ctx) => {
        const select = async (table: string, column: string, order: string) => {
          const { rows } = await ctx.client.query(
            `select * from ${ctx.schema}.${table} where ${column} = $1 order by ${order}`,
            [userId],
          );
          return rows as Record<string, unknown>[];
        };
        const user = (await select('app_users', 'id', 'id'))[0]!;
        return {
          exportedAt: new Date().toISOString(),
          formatVersion: 1 as const,
          user,
          legalAcceptances: await select('legal_acceptances', 'user_id', 'accepted_at, document'),
          plans: await select('plans', 'user_id', 'created_at, id'),
          weekPatterns: await select('week_patterns', 'user_id', 'plan_id'),
          dayOverrides: await select('day_overrides', 'user_id', 'plan_id, date'),
          tasks: await select('tasks', 'user_id', 'plan_id, sort_order'),
          logs: await select('logs', 'user_id', 'date, created_at, id'),
          events: await select('events', 'user_id', 'created_at, id'),
        };
      }),

    /**
     * Deletes the Skillstack rows, then the Supabase Auth user, in ONE transaction: if the Auth
     * deletion fails the rows come back (rollback) and the whole request can simply be retried.
     * The reverse needs no special case: if the Auth user is deleted but the commit then fails,
     * the retry finds no Auth user (404 counts as success) and deletes the rows.
     * Why not commit first: delete_account() also removes the email from the allowlist, so the
     * guard answers 403 to a retry and the Auth user could never be removed afterwards.
     * Only the verified user's own id is ever sent to Supabase.
     */
    deleteAccount: (userId: string) =>
      db.withUser(userId, async (ctx) => {
        const { rows } = await ctx.client.query<{ ok: boolean }>(
          `select ${ctx.schema}.delete_account() as ok`,
        );
        await authAdmin.deleteUser(userId);
        return rows[0]!.ok;
      }),
  };
}

export type AccountService = ReturnType<typeof createAccountService>;
