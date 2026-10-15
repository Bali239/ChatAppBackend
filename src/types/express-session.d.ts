declare module 'express-session' {
  interface SessionData {
    userId?: string;
    csrfToken?: string;
    createdAt?: Date;
    lastActivityAt?: Date;
    expiresAt?: Date;
    idleExpiresAt?: Date;
    oauthState?: string;
    oauthNonce?: string;
    oauthReturnTo?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        displayName: string;
        avatarUrl?: string | null;
        accountStatus: 'active' | 'disabled';
      };
    }
  }
}

export {};
