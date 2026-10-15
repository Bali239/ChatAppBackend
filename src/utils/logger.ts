import pino, { type Logger } from 'pino';
import { pinoHttp } from 'pino-http';

export function createLogger(level: string = 'info'): Logger {
  return pino({
    level,
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'res.headers.set-cookie',
        '*.password',
        '*.token',
        '*.secret',
        '*.uri',
        '*.connectionString',
      ],
      remove: true,
    },
  });
}

export function createHttpLogger(logger: Logger) {
  return pinoHttp({
    logger,
    serializers: {
      req: (request) => ({ method: request.method }),
      res: (response) => ({ statusCode: response.statusCode }),
      err: (error) => ({ type: error.name }),
    },
    customLogLevel: (_request, response, error) => {
      if (error || response.statusCode >= 500) return 'error';
      if (response.statusCode >= 400) return 'warn';
      return 'info';
    },
    customErrorMessage: () => 'request failed',
    autoLogging: {
      ignore: (request) => request.url?.startsWith('/api/v1/health') ?? false,
    },
  });
}

export type AppLogger = Logger;