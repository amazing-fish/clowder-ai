/**
 * Quiet request logging: replaces Fastify's built-in per-request logs
 * (two info lines per request, ~68% of api.log volume — mostly frontend polling).
 *
 * Emits one line per completed request:
 * - info  → status >= 400, slow (>= SLOW_REQUEST_MS), or non-GET/HEAD/OPTIONS (state changes)
 * - debug → everything else (visible with LOG_LEVEL=debug / --debug)
 *
 * Requires `Fastify({ disableRequestLogging: true })`; register before routes.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export const SLOW_REQUEST_MS = 1_000;

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type RequestLogLevel = 'info' | 'debug';

export function resolveRequestLogLevel(method: string, statusCode: number, elapsedMs: number): RequestLogLevel {
  if (statusCode >= 400) return 'info';
  if (elapsedMs >= SLOW_REQUEST_MS) return 'info';
  if (!READ_METHODS.has(method.toUpperCase())) return 'info';
  return 'debug';
}

function logCompletedRequest(request: FastifyRequest, reply: FastifyReply): void {
  const elapsedMs = Math.round(reply.elapsedTime);
  const level = resolveRequestLogLevel(request.method, reply.statusCode, elapsedMs);
  request.log[level](
    { method: request.method, url: request.url, statusCode: reply.statusCode, elapsedMs },
    `${request.method} ${request.url} ${reply.statusCode} ${elapsedMs}ms`,
  );
}

export function registerRequestLogHook(app: FastifyInstance): void {
  app.addHook('onResponse', async (request, reply) => {
    logCompletedRequest(request, reply);
  });
}
