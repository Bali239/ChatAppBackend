import { createServer } from 'node:http';
import { io as createSocketClient, type Socket } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { attachSocketServer } from '../src/realtime/socket.js';
import { createLogger } from '../src/utils/logger.js';

const trustedOrigin = 'http://localhost:3000';

describe('local HTTP and Socket.IO integration', () => {
  it('serves health, enforces credentialed CORS, and accepts an allowed socket handshake', async () => {
    const logger = createLogger('silent');
    const app = createApp({
      frontendOrigins: [trustedOrigin],
      environment: 'test',
      logger,
      getDatabaseStatus: () => 'connected',
    });
    const httpServer = createServer(app);
    const socketServer = attachSocketServer(httpServer, [trustedOrigin], logger);
    let client: Socket | undefined;
    let unavailableClient: Socket | undefined;

    await new Promise<void>((resolveListen) => {
      httpServer.listen(0, '127.0.0.1', resolveListen);
    });

    const address = httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected the test server to bind to a TCP port');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const healthResponse = await fetch(`${baseUrl}/api/v1/health`);
      expect(healthResponse.status).toBe(200);
      const healthBody = (await healthResponse.json()) as { data: { ready: boolean } };
      expect(healthBody.data.ready).toBe(true);

      const trustedResponse = await fetch(`${baseUrl}/api/v1/health`, {
        headers: { Origin: trustedOrigin },
      });
      expect(trustedResponse.headers.get('access-control-allow-origin')).toBe(trustedOrigin);
      expect(trustedResponse.headers.get('access-control-allow-credentials')).toBe('true');

      const trustedPreflight = await fetch(`${baseUrl}/api/v1/health`, {
        method: 'OPTIONS',
        headers: {
          Origin: trustedOrigin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      });
      expect(trustedPreflight.status).toBe(204);
      expect(trustedPreflight.headers.get('access-control-allow-origin')).toBe(trustedOrigin);
      expect(trustedPreflight.headers.get('access-control-allow-credentials')).toBe('true');

      const untrustedResponse = await fetch(`${baseUrl}/api/v1/health`, {
        headers: { Origin: 'https://untrusted.example' },
      });
      expect(untrustedResponse.status).toBe(403);
      expect(untrustedResponse.headers.get('access-control-allow-origin')).toBeNull();

      const untrustedPreflight = await fetch(`${baseUrl}/api/v1/health`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://untrusted.example',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      });
      expect(untrustedPreflight.status).toBe(403);
      expect(untrustedPreflight.headers.get('access-control-allow-origin')).toBeNull();

      client = createSocketClient(baseUrl, {
        withCredentials: true,
        reconnection: false,
        timeout: 2_000,
        transports: ['websocket'],
        extraHeaders: { Origin: trustedOrigin },
      });
      await new Promise<void>((resolveConnect, rejectConnect) => {
        client?.once('connect', resolveConnect);
        client?.once('connect_error', rejectConnect);
      });
      expect(client.connected).toBe(true);

      unavailableClient = createSocketClient('http://127.0.0.1:1', {
        reconnection: false,
        timeout: 500,
        transports: ['websocket'],
      });
      await expect(
        new Promise<void>((resolveConnect, rejectConnect) => {
          unavailableClient?.once('connect', resolveConnect);
          unavailableClient?.once('connect_error', rejectConnect);
        }),
      ).rejects.toBeDefined();
    } finally {
      client?.disconnect();
      unavailableClient?.disconnect();
      await new Promise<void>((resolveClose) => socketServer.close(() => resolveClose()));
    }
  });
});