import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { FastifyInstance } from 'fastify';

const VALID_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Used as Fastify's `genReqId`: keep a well-formed client id, otherwise make a new one. */
export function generateRequestId(req: Pick<IncomingMessage, 'headers'>): string {
  const incoming = req.headers['x-request-id'];
  return typeof incoming === 'string' && VALID_ID.test(incoming) ? incoming : randomUUID();
}

/** Echoes the request id in the response. pino adds it to every log line as `reqId`. */
export function installRequestId(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });
}
