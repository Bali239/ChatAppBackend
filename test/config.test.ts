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
      SESSION_SECRET: 'this_is_a_valid_session_secret_value',
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-client-secret',
      GOOGLE_CALLBACK_URL: 'https://api.example.com/api/v1/auth/google/callback',
      CLOUDINARY_CLOUD_NAME: 'test-cloud',
      CLOUDINARY_API_KEY: 'test-api-key',
      CLOUDINARY_API_SECRET: 'test-api-secret',
      CLOUDINARY_AVATAR_UPLOAD_PRESET: 'signed-avatar-preset',
      POST_LOGIN_REDIRECT_URL: 'https://chat.example.com/dashboard',
      POST_LOGOUT_REDIRECT_URL: 'https://chat.example.com/',
      AUTH_REDIRECT_ALLOWLIST: 'https://chat.example.com/dashboard,https://chat.example.com/',
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

  it('allows incomplete Cloudinary values outside production so avatar upload can stay disabled', () => {
    expect(() =>
      parseEnvironment({
        MONGODB_URI: 'mongodb://127.0.0.1:27017/chat_app',
        FRONTEND_URL: 'http://localhost:3000',
        CLOUDINARY_CLOUD_NAME: 'test-cloud',
      }),
    ).not.toThrow();
  });

  it('requires production OAuth and session settings to be configured', () => {
    const productionBase = {
      NODE_ENV: 'production',
      PORT: '4000',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/chat_app',
      FRONTEND_URL: 'https://app.example.com',
      COOKIE_SECURE: 'true',
      SESSION_SECRET: 'this_is_a_valid_session_secret_value',
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-client-secret',
      GOOGLE_CALLBACK_URL: 'https://api.example.com/api/v1/auth/google/callback',
      CLOUDINARY_CLOUD_NAME: 'test-cloud',
      CLOUDINARY_API_KEY: 'test-api-key',
      CLOUDINARY_API_SECRET: 'test-api-secret',
      CLOUDINARY_AVATAR_UPLOAD_PRESET: 'signed-avatar-preset',
      POST_LOGIN_REDIRECT_URL: 'https://app.example.com/dashboard',
      POST_LOGOUT_REDIRECT_URL: 'https://app.example.com/',
      AUTH_REDIRECT_ALLOWLIST: 'https://app.example.com/dashboard,https://app.example.com/',
    };

    expect(() => parseEnvironment(productionBase)).not.toThrow();

    expect(() =>
      parseEnvironment({
        ...productionBase,
        SESSION_SECRET: undefined,
      }),
    ).toThrow(/SESSION_SECRET/);

    expect(() =>
      parseEnvironment({
        ...productionBase,
        GOOGLE_CLIENT_ID: undefined,
      }),
    ).toThrow(/GOOGLE_CLIENT_ID/);

    expect(() =>
      parseEnvironment({
        ...productionBase,
        GOOGLE_CALLBACK_URL: 'http://api.example.com/api/v1/auth/google/callback',
      }),
    ).toThrow(/GOOGLE_CALLBACK_URL/);

    expect(() =>
      parseEnvironment({
        ...productionBase,
        CLOUDINARY_AVATAR_UPLOAD_PRESET: undefined,
      }),
    ).toThrow(/CLOUDINARY_AVATAR_UPLOAD_PRESET/);
  });
});