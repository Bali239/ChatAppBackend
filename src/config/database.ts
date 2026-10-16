import mongoose from 'mongoose';
import type { AppLogger } from '../utils/logger.js';

export type DatabaseStatus = 'connected' | 'connecting' | 'disconnected' | 'disconnecting';

export function getDatabaseStatus(): DatabaseStatus {
  switch (mongoose.connection.readyState) {
    case 1:
      return 'connected';
    case 2:
      return 'connecting';
    case 3:
      return 'disconnecting';
    default:
      return 'disconnected';
  }
}

function getSafeConnectionError(error: unknown): Record<string, string | number> {
  if (!error || typeof error !== 'object') return { errorType: 'UnknownError' };

  const source = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    syscall?: unknown;
    hostname?: unknown;
    address?: unknown;
    port?: unknown;
  };
  const details: Record<string, string | number> = {
    errorType: typeof source.name === 'string' ? source.name : 'UnknownError',
  };
  if (typeof source.message === 'string') {
    details.errorMessage = source.message.replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, 'MongoDB URI [redacted]');
  }
  if (typeof source.code === 'string' || typeof source.code === 'number') details.errorCode = source.code;
  if (typeof source.syscall === 'string') details.syscall = source.syscall;
  if (typeof source.hostname === 'string') details.hostname = source.hostname;
  if (typeof source.address === 'string') details.address = source.address;
  if (typeof source.port === 'number') details.port = source.port;
  return details;
}

export async function connectDatabase(uri: string, logger: AppLogger): Promise<void> {
  try {
    await mongoose.connect(uri);
    logger.info('MongoDB connected');
  } catch (error) {
    await mongoose.disconnect().catch(() => undefined);
    logger.error(
      getSafeConnectionError(error),
      'MongoDB connection failed',
    );
    throw new Error('MongoDB connection failed');
  }
}

export async function disconnectDatabase(logger: AppLogger): Promise<void> {
  if (mongoose.connection.readyState === 0) return;

  await mongoose.disconnect();
  logger.info('MongoDB disconnected');
}
