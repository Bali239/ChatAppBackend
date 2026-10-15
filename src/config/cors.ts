import type { CorsOptions } from 'cors';
import { AppError } from '../utils/app-error.js';

export function isTrustedOrigin(origins: readonly string[], origin: string | undefined): boolean {
  return origin === undefined || origins.includes(origin);
}

export function createCorsOptions(origins: readonly string[]): CorsOptions {
  return {
    origin: (origin, callback) => {
      if (isTrustedOrigin(origins, origin)) {
        callback(null, true);
        return;
      }

      callback(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Origin is not allowed'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
    maxAge: 600,
  };
}