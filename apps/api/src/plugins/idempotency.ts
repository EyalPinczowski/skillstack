import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../errors';

declare module 'fastify' {
  interface FastifyRequest {
    /** Validated `Idempotency-Key` header, if the client sent one. */
    idempotencyKey?: string;
  }
}

export interface StoredResponse {
  statusCode: number;
  body: unknown;
}

/**
 * TODO: back this with the database (a table keyed by user_id + key) before any write endpoint
 * relies on it. Until then write endpoints must not claim to be idempotent.
 */
export interface IdempotencyStore {
  get(key: string): Promise<StoredResponse | undefined>;
  set(key: string, response: StoredResponse): Promise<void>;
}

/** Test-only: forgets everything on restart and is not shared between instances. */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, StoredResponse>();

  async get(key: string) {
    return this.entries.get(key);
  }

  async set(key: string, response: StoredResponse) {
    this.entries.set(key, response);
  }
}

const keySchema = z.uuid();

/** Reads `Idempotency-Key` (a client-generated UUID) into `request.idempotencyKey`. */
export function installIdempotency(app: FastifyInstance): void {
  app.decorateRequest('idempotencyKey', undefined);
  app.addHook('onRequest', async (request) => {
    const header = request.headers['idempotency-key'];
    if (header === undefined) return;
    const parsed = keySchema.safeParse(header);
    if (!parsed.success) {
      throw new HttpError(400, 'validation_error', 'Idempotency-Key must be a UUID.');
    }
    request.idempotencyKey = parsed.data;
  });
}
