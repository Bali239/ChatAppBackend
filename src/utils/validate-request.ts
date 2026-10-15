import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { AppError } from './error.js';

type RequestSchemas = Partial<Record<'body' | 'query' | 'params', ZodType>>;

export function validateRequest(schemas: RequestSchemas): RequestHandler {
  return (request, response, next) => {
    const validated: Record<string, unknown> = {};

    for (const part of ['body', 'query', 'params'] as const) {
      const schema = schemas[part];
      if (!schema) continue;

      const result = schema.safeParse(request[part]);
      if (!result.success) {
        const details = result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        }));
        return next(new AppError(400, 'VALIDATION_FAILED', 'Request validation failed', details));
      }

      validated[part] = result.data;
    }

    response.locals.validated = validated;
    return next();
  };
}