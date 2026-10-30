import type { EnvironmentNames } from './names';

const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;
const TOKEN = /\{\{([^{}]*)\}\}/g;

/** Replaces `{{schema}}`, `{{owner}}`, `{{app}}`, `{{app_user}}` and `{{backup}}` in SQL text. */
export function renderSql(sql: string, names: EnvironmentNames): string {
  const values: Record<string, string> = {
    schema: names.schema,
    owner: names.owner,
    app: names.app,
    app_user: names.appUser,
    backup: names.backup,
  };
  for (const [token, value] of Object.entries(values)) {
    if (!IDENTIFIER.test(value))
      throw new Error(`Refusing to render: invalid identifier for {{${token}}}.`);
  }
  return sql.replace(TOKEN, (_match, raw: string) => {
    const token = raw.trim();
    const value = Object.hasOwn(values, token) ? values[token] : undefined;
    if (value === undefined) throw new Error(`Unknown token {{${token}}} in SQL.`);
    return value;
  });
}
