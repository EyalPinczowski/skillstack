import type { IdempotencyStore, StoredResponse } from '../src/plugins/idempotency';

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
