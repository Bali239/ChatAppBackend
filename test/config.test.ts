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

  it('requires secure cookies and HTTPS origins in production', () => {
    const productionEnvironment = {
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/chat_app',
      FRONTEND_URL: 'https://chat.example.com',
      COOKIE_SECURE: 'true',
      COOKIE_SAME_SITE: 'none',
    };

    expect(parseEnvironment(productionEnvironment).COOKIE_SECURE).toBe(true);
    expect(() =>
      parseEnvironment({ ...productionEnvironment, COOKIE_SECURE: 'false' }),
    ).toThrow(/COOKIE_SECURE/);
    expect(() =>
      parseEnvironment({ ...productionEnvironment, FRONTEND_URL: 'http://chat.example.com' }),
    ).toThrow(/HTTPS/);
  });

  it('rejects invalid origins and SameSite=None without secure cookies', () => {
    expect(() =>
      parseEnvironment({
        MONGODB_URI: 'mongodb://127.0.0.1:27017/chat_app',
        FRONTEND_URL: 'https://chat.example.com/path',
      }),
    ).toThrow(/origin/);
    expect(() =>
      parseEnvironment({
        MONGODB_URI: 'mongodb://127.0.0.1:27017/chat_app',
        FRONTEND_URL: 'http://localhost:3000',
        COOKIE_SAME_SITE: 'none',
        COOKIE_SECURE: 'false',
      }),
    ).toThrow(/COOKIE_SECURE/);
  });
});