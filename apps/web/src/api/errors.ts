import { z } from 'zod';

/** The API's single error shape (apps/api/src/errors.ts). */
const errorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), requestId: z.string().optional() }),
});

export type ApiErrorKind = 'http' | 'network' | 'timeout';

/** Every failure of an API call: an error response, no connection, or no answer in time. */
export class ApiError extends Error {
  constructor(
    public readonly kind: ApiErrorKind,
    /** HTTP status, or 0 when there was no response. */
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static fromBody(status: number, body: unknown): ApiError {
    const parsed = errorBodySchema.safeParse(body);
    if (parsed.success) {
      const { code, message, requestId } = parsed.data.error;
      return new ApiError('http', status, code, message, requestId);
    }
    return new ApiError('http', status, 'unknown', `The server answered with status ${status}.`);
  }

  static network(): ApiError {
    return new ApiError('network', 0, 'network', 'Can’t reach the server.');
  }

  static timeout(): ApiError {
    return new ApiError('timeout', 0, 'timeout', 'The server took too long to answer.');
  }
}

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;
