import type { Response } from 'express';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface ErrorResponse<T> {
  statusCode: number;
  message: string;
  data: T;
}

export function sendErrorResponse<T>(
  response: Response,
  statusCode: number,
  message: string,
  data: T,
): Response<ErrorResponse<T>> {
  return response.status(statusCode).json({
    statusCode,
    message,
    data,
  });
}