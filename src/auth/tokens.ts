import { createHmac, timingSafeEqual } from 'node:crypto';

const TOKEN_ISSUER = 'chatapp-api';
const TOKEN_AUDIENCE = 'chatapp-web';
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const OAUTH_STATE_TTL_SECONDS = 10 * 60;

interface TokenPayload {
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  purpose: 'access' | 'oauth-state';
  sub?: string;
  ver?: number;
  sid?: string;
  clientState?: string;
  nonce?: string;
  returnTo?: string;
}

export interface AccessTokenClaims {
  userId: string;
  tokenVersion: number;
  sessionId: string;
  expiresAt: number;
}

export interface OAuthStateClaims {
  clientState: string;
  nonce: string;
  returnTo: string;
}

function encode(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function sign(payload: TokenPayload, secret: string): string {
  const header = encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = encode(JSON.stringify(payload));
  const content = `${header}.${body}`;
  const signature = createHmac('sha256', secret).update(content).digest('base64url');
  return `${content}.${signature}`;
}

function verify(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): TokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token');
  const [headerPart, payloadPart, signaturePart] = parts;
  const content = `${headerPart}.${payloadPart}`;
  const expected = createHmac('sha256', secret).update(content).digest();
  const actual = Buffer.from(signaturePart, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('Invalid token signature');
  }

  const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as { alg?: unknown };
  const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as TokenPayload;
  if (
    header.alg !== 'HS256' ||
    payload.iss !== TOKEN_ISSUER ||
    payload.aud !== TOKEN_AUDIENCE ||
    !Number.isInteger(payload.iat) ||
    !Number.isInteger(payload.exp) ||
    payload.exp <= nowSeconds ||
    payload.iat > nowSeconds + 60
  ) {
    throw new Error('Invalid or expired token');
  }
  return payload;
}

export function issueAccessToken(
  userId: string,
  tokenVersion: number,
  sessionId: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  return sign({
    iss: TOKEN_ISSUER,
    aud: TOKEN_AUDIENCE,
    iat: nowSeconds,
    exp: nowSeconds + ACCESS_TOKEN_TTL_SECONDS,
    purpose: 'access',
    sub: userId,
    ver: tokenVersion,
    sid: sessionId,
  }, secret);
}

export function verifyAccessToken(token: string, secret: string): AccessTokenClaims {
  const payload = verify(token, secret);
  if (
    payload.purpose !== 'access' ||
    typeof payload.sub !== 'string' ||
    !Number.isInteger(payload.ver) ||
    typeof payload.sid !== 'string'
  ) {
    throw new Error('Invalid access token');
  }
  return {
    userId: payload.sub,
    tokenVersion: payload.ver!,
    sessionId: payload.sid,
    expiresAt: payload.exp,
  };
}

export function issueOAuthState(
  claims: OAuthStateClaims,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  return sign({
    iss: TOKEN_ISSUER,
    aud: TOKEN_AUDIENCE,
    iat: nowSeconds,
    exp: nowSeconds + OAUTH_STATE_TTL_SECONDS,
    purpose: 'oauth-state',
    ...claims,
  }, secret);
}

export function verifyOAuthState(token: string, secret: string): OAuthStateClaims {
  const payload = verify(token, secret);
  if (
    payload.purpose !== 'oauth-state' ||
    typeof payload.clientState !== 'string' ||
    typeof payload.nonce !== 'string' ||
    typeof payload.returnTo !== 'string'
  ) {
    throw new Error('Invalid OAuth state');
  }
  return {
    clientState: payload.clientState,
    nonce: payload.nonce,
    returnTo: payload.returnTo,
  };
}
