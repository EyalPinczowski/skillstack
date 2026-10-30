import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../scripts/openapi-dump';

describe('openapi dump', () => {
  it('builds the document without a database and lists the account routes', async () => {
    const doc = JSON.parse(await buildOpenApiDocument()) as {
      openapi: string;
      paths: Record<string, Record<string, unknown>>;
      components: { securitySchemes: Record<string, unknown> };
    };
    expect(doc.openapi).toMatch(/^3\./);
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/api/v1/me', '/api/v1/me/export', '/api/v1/me/legal-acceptances']),
    );
    expect(Object.keys(doc.paths['/api/v1/me']!)).toEqual(
      expect.arrayContaining(['get', 'patch', 'delete']),
    );
    expect(doc.components.securitySchemes).toHaveProperty('bearerAuth');
  });

  it('is deterministic, so a drift check can compare it', async () => {
    expect(await buildOpenApiDocument()).toBe(await buildOpenApiDocument());
  });
});
