import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { ACCESS_TOKEN_TTL_SECONDS, issueAccessToken } from './tokens.js';
import { AuthSession } from '../models/auth-session.model.js';

export const REFRESH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const ROTATION_HISTORY_LIMIT = 32;

export interface IssuedSessionTokens {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresAt: Date;
}

export type RefreshResult =
  | { status: 'rotated'; userId: string; tokenVersion: number; tokens: IssuedSessionTokens }
  | { status: 'invalid' }
  | { status: 'reused'; sessionId: string; userId: string };

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function createRefreshToken(sessionId: string): string {
  return `${sessionId}.${randomBytes(32).toString('base64url')}`;
}

function createAccessTokenBundle(
  userId: string,
  sessionId: string,
  tokenVersion: number,
  refreshToken: string,
  expiresAt: Date,
  tokenSecret: string,
): IssuedSessionTokens {
  return {
    sessionId,
    accessToken: issueAccessToken(userId, tokenVersion, sessionId, tokenSecret),
    refreshToken,
    accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenExpiresAt: expiresAt,
  };
}

export async function createAuthSession(
  userId: string,
  tokenVersion: number,
  tokenSecret: string,
): Promise<IssuedSessionTokens> {
  const sessionId = randomUUID();
  const refreshToken = createRefreshToken(sessionId);
  const expiresAt = new Date(Date.now() + REFRESH_SESSION_TTL_MS);
  await AuthSession.create({
    userId: new Types.ObjectId(userId),
    sessionId,
    tokenVersion,
    refreshTokenHash: hashRefreshToken(refreshToken),
    expiresAt,
  });
  return createAccessTokenBundle(
    userId,
    sessionId,
    tokenVersion,
    refreshToken,
    expiresAt,
    tokenSecret,
  );
}

export async function rotateRefreshToken(
  token: unknown,
  tokenSecret: string,
): Promise<RefreshResult> {
  if (typeof token !== 'string') return { status: 'invalid' };
  const separator = token.indexOf('.');
  if (separator < 1) return { status: 'invalid' };
  const sessionId = token.slice(0, separator);
  if (!SESSION_ID_PATTERN.test(sessionId)) return { status: 'invalid' };

  const oldHash = hashRefreshToken(token);
  const now = new Date();
  const newRefreshToken = createRefreshToken(sessionId);
  const newHash = hashRefreshToken(newRefreshToken);
  const session = await AuthSession.findOneAndUpdate(
    {
      sessionId,
      refreshTokenHash: oldHash,
      revokedAt: null,
      expiresAt: { $gt: now },
    },
    {
      $set: { refreshTokenHash: newHash, lastUsedAt: now, rotatedAt: now },
      $inc: { rotationCounter: 1 },
      $push: {
        previousTokenHashes: {
          $each: [{ tokenHash: oldHash, rotatedAt: now }],
          $slice: -ROTATION_HISTORY_LIMIT,
        },
      },
    },
    { new: true },
  ).select('+refreshTokenHash');

  if (!session) {
    const previous = await AuthSession.findOne({ sessionId }).select('+previousTokenHashes');
    if (
      previous &&
      !previous.revokedAt &&
      previous.expiresAt > now &&
      previous.previousTokenHashes.some((entry) => entry.tokenHash === oldHash)
    ) {
      await AuthSession.updateOne(
        { sessionId, revokedAt: null },
        { $set: { revokedAt: now, revocationReason: 'refresh_reuse' } },
      );
      return { status: 'reused', sessionId, userId: previous.userId.toString() };
    }
    return { status: 'invalid' };
  }

  const userId = session.userId.toString();
  const nextTokens = createAccessTokenBundle(
    userId,
    sessionId,
    session.tokenVersion,
    newRefreshToken,
    session.expiresAt,
    tokenSecret,
  );
  return { status: 'rotated', userId, tokenVersion: session.tokenVersion, tokens: nextTokens };
}

export async function revokeAuthSession(
  sessionId: string,
  userId: string,
  reason: 'logout' | 'refresh_reuse' = 'logout',
): Promise<void> {
  await AuthSession.updateOne(
    { sessionId, userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revocationReason: reason } },
  );
}
