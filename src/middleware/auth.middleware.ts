import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('auth-middleware');

/**
 * API key authentication middleware.
 * Checks for x-api-key header on all non-webhook endpoints.
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const apiKey = request.headers['x-api-key'] as string | undefined;

  if (!apiKey) {
    log.warn({ path: request.url, method: request.method }, 'Missing API key');
    reply.status(401).send({
      error: 'Unauthorized',
      message: 'Missing x-api-key header',
    });
    return;
  }

  if (apiKey !== env.API_KEY) {
    log.warn({ path: request.url, method: request.method }, 'Invalid API key');
    reply.status(403).send({
      error: 'Forbidden',
      message: 'Invalid API key',
    });
    return;
  }
}
