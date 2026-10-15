import { randomUUID } from 'node:crypto';
import MongoStore from 'connect-mongo';
import type { RequestHandler } from 'express';
import session from 'express-session';

export interface SessionMiddlewareOptions {
  secret: string;
  cookieName?: string;
  mongoUri?: string;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  maxAge?: number;
  isProduction?: boolean;
}

export function buildSessionCookieOptions(
  options: Pick<SessionMiddlewareOptions, 'secure' | 'sameSite' | 'maxAge'>,
): session.CookieOptions {
  const secure = options.secure ?? false;
  const sameSite = options.sameSite ?? 'lax';
  const maxAge = options.maxAge ?? 7 * 24 * 60 * 60 * 1000;

  return {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    maxAge,
    expires: new Date(Date.now() + maxAge),
  };
}

export interface SessionPayload {
  userId: string;
  isAuthenticated: true;
  createdAt: Date;
  lastActivityAt: Date;
  idleExpiresAt: Date;
  expiresAt: Date;
  revokedAt?: Date | null;
}

export function buildSessionPayload(params: {
  userId: string;
  createdAt?: Date | string;
  idleMs?: number;
  absoluteMs?: number;
  lastActivityAt?: Date | string;
  now?: Date | string;
}): SessionPayload {
  const createdAt = params.createdAt ? new Date(params.createdAt) : new Date();
  const lastActivityAt = params.lastActivityAt ? new Date(params.lastActivityAt) : new Date();
  const now = params.now ? new Date(params.now) : new Date();
  const idleMs = params.idleMs ?? 7 * 24 * 60 * 60 * 1000;
  const absoluteMs = params.absoluteMs ?? 30 * 24 * 60 * 60 * 1000;

  return {
    userId: params.userId,
    isAuthenticated: true,
    createdAt,
    lastActivityAt: lastActivityAt > now ? lastActivityAt : now,
    idleExpiresAt: new Date(Math.max(now.getTime(), lastActivityAt.getTime()) + idleMs),
    expiresAt: new Date(createdAt.getTime() + absoluteMs),
  };
}

export function isSessionExpired(
  session: Partial<SessionPayload> & {
    expiresAt?: Date | string | null;
    idleExpiresAt?: Date | string | null;
  },
  now = new Date(),
): boolean {
  if (!session.expiresAt) return true;
  const absoluteExpiry = new Date(session.expiresAt).getTime();
  const idleExpiry = session.idleExpiresAt
    ? new Date(session.idleExpiresAt).getTime()
    : Number.POSITIVE_INFINITY;
  return (
    !Number.isFinite(absoluteExpiry) ||
    !Number.isFinite(idleExpiry) && idleExpiry !== Number.POSITIVE_INFINITY ||
    absoluteExpiry <= now.getTime() ||
    idleExpiry <= now.getTime()
  );
}

export function createSessionMiddleware(
  options: SessionMiddlewareOptions,
): RequestHandler {
  const cookieName = options.cookieName ?? '__Host-chat_session';
  const secure = options.secure ?? false;
  const sessionStore = options.mongoUri
    ? MongoStore.create({
        mongoUrl: options.mongoUri,
        collectionName: 'sessions',
        ttl: (options.maxAge ?? 7 * 24 * 60 * 60 * 1000) / 1000,
        autoRemove: 'native',
        touchAfter: 60,
      })
    : undefined;

  return session({
    name: cookieName,
    secret: options.secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: options.isProduction ?? false,
    store: sessionStore,
    cookie: buildSessionCookieOptions({
      secure,
      sameSite: options.sameSite ?? 'lax',
      maxAge: options.maxAge ?? 7 * 24 * 60 * 60 * 1000,
    }),
    genid: () => randomUUID(),
  });
}
