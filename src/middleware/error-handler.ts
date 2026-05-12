import type { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('error-handler');

/**
 * Global error handler for all Fastify routes.
 * Returns structured error responses and logs details.
 */
export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  const statusCode = error.statusCode ?? 500;

  // Log the error
  if (statusCode >= 500) {
    log.error(
      {
        err: error,
        method: request.method,
        url: request.url,
        statusCode,
      },
      'Internal server error'
    );
  } else {
    log.warn(
      {
        message: error.message,
        method: request.method,
        url: request.url,
        statusCode,
      },
      'Client error'
    );
  }

  // Structured error response
  reply.status(statusCode).send({
    error: statusCode >= 500 ? 'Internal Server Error' : error.message,
    message:
      statusCode >= 500
        ? 'An unexpected error occurred. Please try again later.'
        : error.message,
    statusCode,
    ...(process.env.NODE_ENV === 'development' && {
      stack: error.stack,
    }),
  });
}
