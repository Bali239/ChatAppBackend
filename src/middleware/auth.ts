import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { User } from '../models/user.model.js';
import { AppError } from '../utils/error.js';
import { verifyAccessToken } from '../auth/tokens.js';

export type AuthenticatedUser = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  accountStatus: 'active' | 'disabled';
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export type AuthenticatedRequest = Request & {
  user?: AuthenticatedUser;
};

export function createRequireAuth(tokenSecret: string): RequestHandler {
  return async (request: AuthenticatedRequest, _response: Response, next: NextFunction) => {
    const authorization = request.header('authorization');
    const match = authorization?.match(/^Bearer ([A-Za-z0-9._~-]+)$/);
    if (!match) {
      next(new AppError(401, 'AUTH_REQUIRED', 'Authentication required'));
      return;
    }

    let claims;
    try {
      claims = verifyAccessToken(match[1], tokenSecret);
    } catch {
      next(new AppError(401, 'AUTH_REQUIRED', 'Authentication required'));
      return;
    }

    try {
      const user = await User.findById(claims.userId);
      if (
        !user ||
        !user.isActive() ||
        (user.authTokenVersion ?? 0) !== claims.tokenVersion
      ) {
        next(new AppError(401, 'AUTH_REQUIRED', 'Authentication required'));
        return;
      }

      request.user = {
        id: user._id.toString(),
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl ?? null,
        accountStatus: user.accountStatus,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}
