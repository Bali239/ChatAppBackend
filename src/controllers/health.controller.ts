import type { RequestHandler } from 'express';
import type { DatabaseStatus } from '../config/database.js';
import { sendErrorResponse } from '../utils/error.js';
import { sendSuccessResponse } from '../utils/response.js';

export function createHealthController(getStatus: () => DatabaseStatus): RequestHandler {
  return (_request, response) => {
    const database = getStatus();
    const ready = database === 'connected';
    const data = {
      ready,
      dependencies: { mongodb: database },
    };

    if (!ready) {
      return sendErrorResponse(response, 503, 'Service unavailable', {
        ...data,
        code: 'SERVICE_UNAVAILABLE',
      });
    }

    return sendSuccessResponse(response, 200, 'Service is healthy', {
      ...data,
      status: 'ok',
    });
  };
}