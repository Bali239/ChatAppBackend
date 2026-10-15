import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { buildSessionPayload, isSessionExpired } from '../config/session.js';
import { User } from '../models/user.model.js';
import { AppError } from '../utils/error.js';

export type AuthenticatedUser = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  accountStatus: 'active' | 'disabled';
};

export type AuthenticatedRequest = Request & {
  user?: AuthenticatedUser;
};

export function issueCsrfToken(session: Request['session']): string {
  const token = randomUUID();
  session.csrfToken = token;
  return token;
}

export async function requireAuth(
  request: AuthenticatedRequest,
  _response: Response,
  next: NextFunction,
): Promise<void> {
  if (!request.session) {
    next(new AppError(401, 'AUTH_REQUIRED', 'Authentication required'));
    return;
  }

  const { userId } = request.session;
  if (!userId) {
    next(new AppError(401, 'AUTH_REQUIRED', 'Authentication required'));
    return;
  }

  const isExpired = isSessionExpired({
    expiresAt: request.session.expiresAt,
    idleExpiresAt: request.session.idleExpiresAt,
  });
  if (isExpired) {
    request.session.destroy(() => undefined);
    next(new AppError(401, 'SESSION_EXPIRED', 'Session expired'));
    return;
  }

  const user = await User.findById(userId);
  if (!user || !user.isActive()) {
    request.session.destroy(() => undefined);
    next(new AppError(401, 'AUTH_REQUIRED', 'Authentication required'));
    return;
  }

  const normalizedUserId = user._id.toString();
  const createdAtValue = request.session.createdAt ? new Date(request.session.createdAt) : new Date();
  const lastActivityValue = new Date();
  const nowValue = new Date();
  const updatedSession = buildSessionPayload({
    userId: normalizedUserId,
    createdAt: createdAtValue,
    idleMs: 7 * 24 * 60 * 60 * 1000,
    absoluteMs: 30 * 24 * 60 * 60 * 1000,
    lastActivityAt: lastActivityValue,
    now: nowValue,
  });

  request.session.createdAt = updatedSession.createdAt;
  request.session.lastActivityAt = updatedSession.lastActivityAt;
  request.session.idleExpiresAt = updatedSession.idleExpiresAt;
  request.session.expiresAt = updatedSession.expiresAt;

  request.user = {
    id: user._id.toString(),
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl ?? null,
    accountStatus: user.accountStatus,
  };

  next();
}

export function requireCsrf(
  request: Request,
  _response: Response,
  next: NextFunction,
): void {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
    next();
    return;
  }

  const headerToken = request.headers['x-csrf-token'];
  const token = Array.isArray(headerToken) ? headerToken[0] : headerToken;

  if (!request.session || !request.session.csrfToken || !token || request.session.csrfToken !== token) {
    next(new AppError(403, 'CSRF_INVALID', 'Invalid CSRF token'));
    return;
  }

  next();
}
