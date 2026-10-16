import { parseEnvironment } from '../src/schemas/env.schema.js';

const authTokenSecret = 'a-long-test-auth-token-secret-at-least-32-chars';

describe('environment configuration', () => {
  it('parses local values and multiple explicit frontend origins', () => {
    const environment = parseEnvironment({
      MONGODB_URI: 'mongodb://127.0.0.1:27017/chat_app',
      FRONTEND_URL: 'http://localhost:3000, https://chat.example.com',
      AUTH_TOKEN_SECRET: authTokenSecret,
    });

    expect(environment.PORT).toBe(4000);
    expect(environment.FRONTEND_URL).toEqual([
      'http://localhost:3000',
      'https://chat.example.com',
    ]);
    expect(environment.AUTH_TOKEN_SECRET).toBe(authTokenSecret);
  });

  it('fails with readable field names when required configuration is missing', () => {
    expect(() => parseEnvironment({ NODE_ENV: 'production' })).toThrow(/MONGODB_URI/);
    expect(() => parseEnvironment({ NODE_ENV: 'production' })).toThrow(/FRONTEND_URL/);
    expect(() => parseEnvironment({
      MONGODB_URI: 'mongodb://127.0.0.1:27017/chat_app',
      FRONTEND_URL: 'http://localhost:3000',
    })).toThrow(/AUTH_TOKEN_SECRET/);
  });

  it('requires HTTPS origins and authentication configuration in production', () => {
    const productionEnvironment = {
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/chat_app',
      FRONTEND_URL: 'https://chat.example.com',
      AUTH_TOKEN_SECRET: authTokenSecret,
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-client-secret',
      GOOGLE_CALLBACK_URL: 'https://api.example.com/api/v1/auth/google/callback',
      CLOUDINARY_CLOUD_NAME: 'test-cloud',
      CLOUDINARY_API_KEY: 'test-api-key',
      CLOUDINARY_API_SECRET: 'test-api-secret',
      CLOUDINARY_AVATAR_UPLOAD_PRESET: 'signed-avatar-preset',
      POST_LOGIN_REDIRECT_URL: 'https://chat.example.com/chat',
      POST_LOGOUT_REDIRECT_URL: 'https://chat.example.com/',
      AUTH_REDIRECT_ALLOWLIST: 'https://chat.example.com/chat,https://chat.example.com/',
    };

    expect(parseEnvironment(productionEnvironment).NODE_ENV).toBe('production');
    expect(() => parseEnvironment({
      ...productionEnvironment,
      AUTH_TOKEN_SECRET: 'short',
    })).toThrow(/AUTH_TOKEN_SECRET/);
    expect(() => parseEnvironment({
      ...productionEnvironment,
      FRONTEND_URL: 'http://chat.example.com',
    })).toThrow(/HTTPS/);
  });

  it('rejects invalid origins', () => {
    expect(() => parseEnvironment({
      MONGODB_URI: 'mongodb://127.0.0.1:27017/chat_app',
      FRONTEND_URL: 'https://chat.example.com/path',
      AUTH_TOKEN_SECRET: authTokenSecret,
    })).toThrow(/origin/);
  });

  it('allows incomplete Cloudinary values outside production so avatar upload can stay disabled', () => {
    expect(() => parseEnvironment({
      MONGODB_URI: 'mongodb://127.0.0.1:27017/chat_app',
      FRONTEND_URL: 'http://localhost:3000',
      AUTH_TOKEN_SECRET: authTokenSecret,
      CLOUDINARY_CLOUD_NAME: 'test-cloud',
    })).not.toThrow();
  });

  it('requires production OAuth, token, redirect, and Cloudinary settings', () => {
    const productionBase = {
      NODE_ENV: 'production',
      PORT: '4000',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/chat_app',
      FRONTEND_URL: 'https://app.example.com',
      AUTH_TOKEN_SECRET: authTokenSecret,
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-client-secret',
      GOOGLE_CALLBACK_URL: 'https://api.example.com/api/v1/auth/google/callback',
      CLOUDINARY_CLOUD_NAME: 'test-cloud',
      CLOUDINARY_API_KEY: 'test-api-key',
      CLOUDINARY_API_SECRET: 'test-api-secret',
      CLOUDINARY_AVATAR_UPLOAD_PRESET: 'signed-avatar-preset',
      POST_LOGIN_REDIRECT_URL: 'https://app.example.com/chat',
      POST_LOGOUT_REDIRECT_URL: 'https://app.example.com/',
      AUTH_REDIRECT_ALLOWLIST: 'https://app.example.com/chat,https://app.example.com/',
    };

    expect(() => parseEnvironment(productionBase)).not.toThrow();
    expect(() => parseEnvironment({
      ...productionBase,
      GOOGLE_CLIENT_ID: undefined,
    })).toThrow(/GOOGLE_CLIENT_ID/);
    expect(() => parseEnvironment({
      ...productionBase,
      GOOGLE_CALLBACK_URL: 'http://api.example.com/api/v1/auth/google/callback',
    })).toThrow(/GOOGLE_CALLBACK_URL/);
    expect(() => parseEnvironment({
      ...productionBase,
      CLOUDINARY_AVATAR_UPLOAD_PRESET: undefined,
    })).toThrow(/CLOUDINARY_AVATAR_UPLOAD_PRESET/);
  });
});
