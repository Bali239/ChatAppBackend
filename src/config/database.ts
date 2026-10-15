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

export async function connectDatabase(uri: string, logger: AppLogger): Promise<void> {
  try {
    await mongoose.connect(uri);
    logger.info('MongoDB connected');
  } catch (error) {
    await mongoose.disconnect().catch(() => undefined);
    logger.error(
      { errorType: error instanceof Error ? error.name : 'UnknownError' },
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