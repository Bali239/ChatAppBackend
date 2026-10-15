import type { Response } from 'express';

export interface ApiResponse<T> {
  statusCode: number;
  message: string;
  data: T;
}

export function sendSuccessResponse<T>(
  response: Response,
  statusCode: number,
  message: string,
  data: T,
): Response<ApiResponse<T>> {
  return response.status(statusCode).json({
    statusCode,
    message,
    data,
  });
}