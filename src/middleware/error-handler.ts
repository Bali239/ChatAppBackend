import type { ErrorRequestHandler } from 'express';
import type { Environment } from '../schemas/env.schema.js';
import type { AppLogger } from '../utils/logger.js';
import { AppError } from '../utils/app-error.js';

function sanitizeDevelopmentMessage(message: string): string {
  return message.replace(/mongodb(?:\+srv)?:\/\/[^\s]+/gi, '[redacted MongoDB URI]');
}

export function createErrorHandler(
  environment: Environment['NODE_ENV'],
  logger: AppLogger,
): ErrorRequestHandler {
  return (error: unknown, _request, response, _next) => {
    let handledError: AppError;

    if (error instanceof AppError) {
      handledError = error;
    } else if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
      handledError = new AppError(400, 'INVALID_JSON', 'Request body contains invalid JSON');
    } else {
      const statusCode =
        typeof error === 'object' && error !== null && 'status' in error &&
        typeof error.status === 'number' && error.status >= 400 && error.status < 600
          ? error.status
          : 500;
      handledError = new AppError(
        statusCode,
        statusCode === 413 ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL_ERROR',
        statusCode === 413 ? 'Request body is too large' : 'Internal server error',
      );
    }

    if (handledError.statusCode >= 500) {
      logger.error(
        { errorType: error instanceof Error ? error.name : 'UnknownError' },
        'Request failed',
      );
    } else {
      logger.warn({ statusCode: handledError.statusCode, code: handledError.code }, 'Request rejected');
    }

    const message =
      environment === 'development' && error instanceof Error && !(error instanceof AppError)
        ? sanitizeDevelopmentMessage(error.message)
        : handledError.message;

    response.status(handledError.statusCode).json({
      error: {
        code: handledError.code,
        message,
        ...(handledError.details === undefined ? {} : { details: handledError.details }),
      },
    });
  };
}