import mongoose from 'mongoose';
import { connectDatabase } from '../src/config/database.js';
import { createLogger } from '../src/utils/logger.js';

describe('MongoDB connection handling', () => {
  it('reports a sanitized connection reason without logging credentials or the raw URI', async () => {
    const logger = createLogger('silent');
    const connectionError = new Error('failed to connect to mongodb://user:password@host/private');
    const connectSpy = vi.spyOn(mongoose, 'connect').mockRejectedValueOnce(connectionError);
    const disconnectSpy = vi.spyOn(mongoose, 'disconnect').mockResolvedValueOnce();
    const errorSpy = vi.spyOn(logger, 'error');

    await expect(connectDatabase('mongodb://user:password@host/private', logger)).rejects.toThrow(
      'MongoDB connection failed',
    );
    expect(errorSpy).toHaveBeenCalledWith(
      {
        errorType: 'Error',
        errorMessage: 'failed to connect to MongoDB URI [redacted]',
      },
      'MongoDB connection failed',
    );
    expect(errorSpy).not.toHaveBeenCalledWith(connectionError);
    expect(disconnectSpy).toHaveBeenCalledOnce();
    connectSpy.mockRestore();
    disconnectSpy.mockRestore();
  });
});
