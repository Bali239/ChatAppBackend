import type { RequestHandler } from 'express';
import type { DatabaseStatus } from '../config/database.js';

export function createHealthController(getStatus: () => DatabaseStatus): RequestHandler {
  return (_request, response) => {
    const database = getStatus();
    const ready = database === 'connected';

    response.status(ready ? 200 : 503).json({
      status: 'ok',
      ready,
      dependencies: { mongodb: database },
    });
  };
}