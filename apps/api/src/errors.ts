import type { FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { z } from 'zod';

export const errorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }),
});

/** An error whose code and message are safe to show to the client. */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const clientErrors: Record<number, { code: string; message: string }> = {
  400: { code: 'bad_request', message: 'The request could not be understood.' },
  404: { code: 'not_found', message: 'Resource not found.' },
  413: { code: 'payload_too_large', message: 'The request body is too large.' },
  415: { code: 'unsupported_media_type', message: 'Unsupported content type.' },
  429: { code: 'rate_limited', message: 'Too many requests. Please slow down.' },
};

const body = (requestId: string, code: string, message: string) => ({
  error: { code, message, requestId },
});

/** Every error leaves the API in the same shape; 5xx never exposes messages or stacks. */
export function installErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send(body(request.id, 'not_found', clientErrors[404]!.message)),
  );

  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply
        .status(400)
        .send(
          body(request.id, 'validation_error', 'The request did not match the expected shape.'),
        );
    }
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send(body(request.id, error.code, error.message));
    }
    const status = (error as { statusCode?: unknown }).statusCode;
    if (!isResponseSerializationError(error) && typeof status === 'number' && status < 500) {
      const known = clientErrors[status] ?? clientErrors[400]!;
      return reply.status(status).send(body(request.id, known.code, known.message));
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply
      .status(500)
      .send(body(request.id, 'internal_error', 'Something went wrong on our side.'));
  });
}
