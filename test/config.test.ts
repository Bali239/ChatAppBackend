import { parseEnvironment } from '../src/schemas/env.schema.js';

describe('environment configuration', () => {
  it('parses local values and multiple explicit frontend origins', () => {
    const environment = parseEnvironment({
      MONGODB_URI: 'mongodb://127.0.0.1:27017/chat_app',
      FRONTEND_URL: 'http://localhost:3000, https://chat.example.com',
      COOKIE_SECURE: 'false',
    });

    expect(environment.PORT).toBe(4000);
    expect(environment.FRONTEND_URL).toEqual([
      'http://localhost:3000',
      'https://chat.example.com',
    ]);
    expect(environment.COOKIE_SECURE).toBe(false);
  });

  it('fails with readable field names when required production configuration is missing', () => {
    expect(() => parseEnvironment({ NODE_ENV: 'production' })).toThrow(/MONGODB_URI/);
    expect(() => parseEnvironment({ NODE_ENV: 'production' })).toThrow(/FRONTEND_URL/);
  });
});