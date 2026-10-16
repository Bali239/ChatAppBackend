import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { createRequireAuth } from '../middleware/auth.js';
import { issueOAuthState, verifyOAuthState } from '../auth/tokens.js';
import { User } from '../models/user.model.js';
import { createAuthSession, revokeAuthSession, rotateRefreshToken } from '../auth/refresh-sessions.js';
import { AppError } from '../utils/error.js';
import { sendSuccessResponse } from '../utils/response.js';

export type GoogleOAuthClient = Pick<
  OAuth2Client,
  'generateAuthUrl' | 'getToken' | 'verifyIdToken'
>;

export interface AuthRouterOptions {
  tokenSecret: string;
  googleClientId?: string;
  googleClientSecret?: string;
  googleCallbackUrl?: string;
  postLoginRedirectUrl?: string;
  redirectAllowlist?: readonly string[];
  onLogout?: (sessionId: string, userId: string) => void;
  oauthClient?: GoogleOAuthClient;
}

function matchesSecret(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function normalizeRedirect(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

export function createAuthRouter(options: AuthRouterOptions): Router {
  const router = Router();
  const requireAuth = createRequireAuth(options.tokenSecret);
  const oauthClient = options.oauthClient ?? (
    options.googleClientId && options.googleClientSecret && options.googleCallbackUrl
      ? new OAuth2Client(
          options.googleClientId,
          options.googleClientSecret,
          options.googleCallbackUrl,
        )
      : undefined
  );
  const approvedRedirects = new Set(
    (options.redirectAllowlist ?? []).map(normalizeRedirect).filter(Boolean),
  );

  function resolveRedirect(value: string | undefined): string {
    const normalized = value ? normalizeRedirect(value) : undefined;
    if (!normalized || !approvedRedirects.has(normalized)) {
      throw new AppError(400, 'INVALID_REDIRECT', 'Redirect URL is not allowed');
    }
    return normalized;
  }

  function requireOAuthConfiguration(): GoogleOAuthClient {
    if (!oauthClient || !options.googleClientId || !options.googleCallbackUrl) {
      throw new AppError(503, 'OAUTH_UNAVAILABLE', 'Google sign-in is not configured');
    }
    return oauthClient;
  }

  router.get('/me', requireAuth, (request, response) => {
    const user = request.user;
    if (!user) throw new AppError(401, 'AUTH_REQUIRED', 'Authentication required');
    sendSuccessResponse(response, 200, 'Current user loaded', {
      user: {
        id: user.id,
        name: user.displayName,
        email: user.email,
        avatarUrl: user.avatarUrl ?? null,
      },
    });
  });

  router.post('/logout', requireAuth, async (request, response) => {
    const userId = request.user!.id;
    const sessionId = request.user!.sessionId;
    await revokeAuthSession(sessionId, userId);
    options.onLogout?.(sessionId, userId);
    sendSuccessResponse(response, 200, 'Logged out', { loggedOut: true });
  });

  router.post('/refresh', async (request, response) => {
    const result = await rotateRefreshToken(request.body?.refreshToken, options.tokenSecret);
    if (result.status === 'invalid') {
      throw new AppError(401, 'AUTH_REQUIRED', 'Authentication required');
    }
    if (result.status === 'reused') {
      options.onLogout?.(result.sessionId, result.userId);
      throw new AppError(401, 'AUTH_REQUIRED', 'Authentication required');
    }

    const user = await User.findById(result.userId);
    if (
      !user ||
      !user.isActive() ||
      (user.authTokenVersion ?? 0) !== result.tokenVersion
    ) {
      await revokeAuthSession(result.tokens.sessionId, result.userId);
      options.onLogout?.(result.tokens.sessionId, result.userId);
      throw new AppError(401, 'AUTH_REQUIRED', 'Authentication required');
    }
    sendSuccessResponse(response, 200, 'Access token refreshed', {
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      accessTokenExpiresIn: result.tokens.accessTokenExpiresIn,
      refreshTokenExpiresAt: result.tokens.refreshTokenExpiresAt,
    });
  });

  router.post('/mock-login', async (request, response) => {
    if (request.app.get('env') !== 'test') {
      throw new AppError(404, 'NOT_FOUND', 'Route not found');
    }
    const { userId } = request.body as { userId?: string };
    if (!userId) throw new AppError(400, 'INVALID_REQUEST', 'userId is required');
    const tokens = await createAuthSession(userId, 0, options.tokenSecret);
    sendSuccessResponse(response, 200, 'Mock login successful', tokens);
  });

  router.get('/google', async (request, response) => {
    const client = requireOAuthConfiguration();
    const requestedRedirect = request.query.returnTo;
    const clientState = request.query.clientState;
    if (
      (requestedRedirect !== undefined && typeof requestedRedirect !== 'string') ||
      typeof clientState !== 'string' ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(clientState)
    ) {
      throw new AppError(400, 'OAUTH_STATE_INVALID', 'Google sign-in could not be validated');
    }

    const returnTo = resolveRedirect(requestedRedirect ?? options.postLoginRedirectUrl);
    const nonce = randomBytes(32).toString('base64url');
    const state = issueOAuthState({ clientState, nonce, returnTo }, options.tokenSecret);
    response.redirect(client.generateAuthUrl({
      access_type: 'online',
      include_granted_scopes: true,
      prompt: 'select_account',
      response_type: 'code',
      scope: ['openid', 'email', 'profile'],
      state,
      nonce,
    }));
  });

  router.get('/google/callback', async (request, response) => {
    const client = requireOAuthConfiguration();
    const code = request.query.code;
    const stateToken = request.query.state;
    if (typeof code !== 'string' || typeof stateToken !== 'string') {
      throw new AppError(400, 'OAUTH_STATE_INVALID', 'Google sign-in could not be validated');
    }

    let oauthState;
    try {
      oauthState = verifyOAuthState(stateToken, options.tokenSecret);
    } catch {
      throw new AppError(400, 'OAUTH_STATE_INVALID', 'Google sign-in could not be validated');
    }
    const { tokens: googleTokens } = await client.getToken(code);
    if (!googleTokens.id_token) {
      throw new AppError(401, 'OAUTH_TOKEN_INVALID', 'Google did not return a valid identity token');
    }
    const ticket = await client.verifyIdToken({
      idToken: googleTokens.id_token,
      audience: options.googleClientId,
    });
    const profile = ticket.getPayload();
    if (
      !profile?.sub ||
      !profile.email ||
      profile.email_verified !== true ||
      !profile.name ||
      !profile.nonce ||
      !matchesSecret(profile.nonce, oauthState.nonce)
    ) {
      throw new AppError(401, 'OAUTH_IDENTITY_INVALID', 'Google identity could not be validated');
    }

    const user = await User.upsertFromGoogleProfile({
      googleSub: profile.sub,
      email: profile.email,
      displayName: profile.name,
      avatarUrl: profile.picture,
      emailVerified: true,
    });
    if (!user.isActive()) {
      throw new AppError(403, 'ACCOUNT_DISABLED', 'This account is disabled');
    }

    const tokens = await createAuthSession(
      user._id.toString(),
      user.authTokenVersion ?? 0,
      options.tokenSecret,
    );
    const redirect = new URL(resolveRedirect(oauthState.returnTo));
    redirect.hash = new URLSearchParams({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      state: oauthState.clientState,
    }).toString();
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.redirect(redirect.href);
  });

  return router;
}
