import express from 'express';
import { createServer } from 'node:http';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import { attachSocketServer } from '../src/realtime/socket.js';
import { createErrorHandler } from '../src/middleware/error-handler.js';
import { notFoundHandler } from '../src/middleware/not-found.js';
import { validateRequest } from '../src/utils/validate-request.js';
import { createLogger } from '../src/utils/logger.js';

const origin = 'http://localhost:3000';
const logger = createLogger('silent');

function createTestApp(databaseStatus: 'connected' | 'disconnected' = 'connected') {
  return createApp({
    frontendOrigins: [origin],
    environment: 'test',
    logger,
    getDatabaseStatus: () => databaseStatus,
  });
}

describe('HTTP application', () => {
  it('returns process and database readiness from the health endpoint', async () => {
    const response = await request(createTestApp()).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      ready: true,
      dependencies: { mongodb: 'connected' },
    });
  });

  it('reports database unavailability without claiming readiness', async () => {
    const response = await request(createTestApp('disconnected')).get('/api/v1/health');

    expect(response.status).toBe(503);
    expect(response.body.ready).toBe(false);
    expect(response.body.status).toBe('ok');
  });

  it('permits configured origins with credentials', async () => {
    const response = await request(createTestApp())
      .get('/api/v1/health')
      .set('Origin', origin);

    expect(response.headers['access-control-allow-origin']).toBe(origin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('rejects origins that are not configured', async () => {
    const response = await request(createTestApp())
      .get('/api/v1/health')
      .set('Origin', 'https://untrusted.example');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('returns a consistent not-found response', async () => {
    const response = await request(createTestApp()).get('/api/v1/missing');

    expect(response.status).toBe(404);
    expect(response.body.error).toEqual({ code: 'NOT_FOUND', message: 'Route not found' });
  });
});

describe('request validation', () => {
  it('validates body, query, and path parameters at runtime', async () => {
    const app = express();
    app.use(express.json());
    app.post(
      '/items/:id',
      validateRequest({
        body: z.object({ name: z.string().min(1) }),
        query: z.object({ page: z.coerce.number().int().min(1) }),
        params: z.object({ id: z.string().uuid() }),
      }),
      (_request, response) => response.json(response.locals.validated),
    );
    app.use(notFoundHandler);
    app.use(createErrorHandler('test', logger));

    const validResponse = await request(app)
      .post('/items/9f79bd3f-f3cb-45ed-99d8-0bd8f834ff3b?page=2')
      .send({ name: 'valid' });
    expect(validResponse.status).toBe(200);
    expect(validResponse.body).toEqual({
      body: { name: 'valid' },
      query: { page: 2 },
      params: { id: '9f79bd3f-f3cb-45ed-99d8-0bd8f834ff3b' },
    });

    const invalidResponse = await request(app)
      .post('/items/not-an-id?page=bad')
      .send({ name: '' });
    expect(invalidResponse.status).toBe(400);
    expect(invalidResponse.body.error.code).toBe('VALIDATION_FAILED');
    expect(invalidResponse.body.error.details).toBeInstanceOf(Array);
  });
});

describe('Socket.IO transport', () => {
  it('attaches to the supplied HTTP server and only trusts configured origins', async () => {
    const httpServer = createServer();
    const io = attachSocketServer(httpServer, [origin], logger);
    expect(io.httpServer).toBe(httpServer);

    await new Promise<void>((resolveListen) => httpServer.listen(0, resolveListen));
    await new Promise<void>((resolveClose) => io.close(() => resolveClose()));
    expect(httpServer.listening).toBe(false);
  });
});