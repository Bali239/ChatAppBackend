import mongoose from 'mongoose';
import { startServer } from '../server.js';
import { parseEnvironment } from '../src/schemas/env.schema.js';
import { createLogger } from '../src/utils/logger.js';

describe('HTTP server lifecycle', () => {
  it('binds publicly and closes Socket.IO, HTTP, and MongoDB once on shutdown', async () => {
    const environment = {
      ...parseEnvironment({
        MONGODB_URI: 'mongodb://127.0.0.1:27017/chat_app',
        FRONTEND_URL: 'http://localhost:3000',
      }),
      PORT: 0,
    };
    const logger = createLogger('silent');
    const connectSpy = vi.spyOn(mongoose, 'connect').mockResolvedValue(mongoose);
    let runtime: Awaited<ReturnType<typeof startServer>> | undefined;
    const disconnectSpy = vi.spyOn(mongoose, 'disconnect').mockImplementation(async () => {
      expect(runtime?.httpServer.listening).toBe(false);
    });
    const readyStateSpy = vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1);
    const sigintListeners = process.listenerCount('SIGINT');
    const sigtermListeners = process.listenerCount('SIGTERM');

    try {
      runtime = await startServer(environment, logger);
      const address = runtime.httpServer.address();

      expect(address).not.toBeNull();
      expect(typeof address).toBe('object');
      if (address && typeof address === 'object') {
        expect(address.address).toBe('0.0.0.0');
      }

      await Promise.all([runtime.shutdown(), runtime.shutdown()]);

      expect(runtime.httpServer.listening).toBe(false);
      expect(disconnectSpy).toHaveBeenCalledOnce();
      expect(process.listenerCount('SIGINT')).toBe(sigintListeners);
      expect(process.listenerCount('SIGTERM')).toBe(sigtermListeners);
    } finally {
      if (runtime?.httpServer.listening) await runtime.shutdown();
      connectSpy.mockRestore();
      disconnectSpy.mockRestore();
      readyStateSpy.mockRestore();
    }
  });
});