import { Types, type FilterQuery } from 'mongoose';
import { z } from 'zod';
import { User, normalizeDisplayName, type UserDocument } from '../models/user.model.js';
import { isUserOnline } from '../realtime/presence.js';
import { AppError } from '../utils/error.js';
import { cursorPredicate, decodeCursor, encodeCursor } from './cursor.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MIN_SEARCH_LENGTH = 2;
const MAX_SEARCH_LENGTH = 80;

const directoryRequestSchema = z.object({
  userId: z.string().regex(/^[a-f\d]{24}$/i),
  cursor: z.string().max(256).optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
});

export interface PublicUser {
  id: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  isOnline: boolean;
  createdAt: Date;
}

export interface UserDirectoryPage {
  users: PublicUser[];
  nextCursor: string | null;
  hasMore: boolean;
}

function escapePrefix(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function queryDirectory(
  filter: FilterQuery<UserDocument>,
  limit: number,
): Promise<UserDirectoryPage> {
  const results = await User.find(filter)
    .select('_id displayName email avatarUrl createdAt')
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();
  const hasMore = results.length > limit;
  const page = hasMore ? results.slice(0, limit) : results;
  const lastUser = page.at(-1);

  return {
    users: page.map((user) => ({
      id: user._id.toString(),
      displayName: user.displayName,
      email: user.email,
      avatarUrl: user.avatarUrl ?? null,
      isOnline: isUserOnline(user._id.toString()),
      createdAt: user.createdAt,
    })),
    nextCursor: hasMore && lastUser ? encodeCursor(lastUser.createdAt, lastUser._id) : null,
    hasMore,
  };
}

function parseDirectoryRequest(input: {
  userId: string;
  cursor?: string;
  limit?: number;
}) {
  const result = directoryRequestSchema.safeParse(input);
  if (!result.success) {
    throw new AppError(400, 'INVALID_DIRECTORY_QUERY', 'Directory query is invalid');
  }
  return {
    currentUserId: new Types.ObjectId(result.data.userId),
    cursor: result.data.cursor ? decodeCursor(result.data.cursor) : undefined,
    limit: result.data.limit ?? DEFAULT_PAGE_SIZE,
  };
}

export async function listEligibleUsers(input: {
  userId: string;
  cursor?: string;
  limit?: number;
}): Promise<UserDirectoryPage> {
  const request = parseDirectoryRequest(input);
  const filter: FilterQuery<UserDocument> = {
    accountStatus: 'active',
    _id: { $ne: request.currentUserId },
  };
  if (request.cursor) Object.assign(filter, cursorPredicate(request.cursor));
  return queryDirectory(filter, request.limit);
}

export async function searchEligibleUsers(input: {
  userId: string;
  query: string;
  cursor?: string;
  limit?: number;
}): Promise<UserDirectoryPage> {
  const request = parseDirectoryRequest(input);
  const normalizedQuery = normalizeDisplayName(input.query);
  if (
    normalizedQuery.length < MIN_SEARCH_LENGTH ||
    normalizedQuery.length > MAX_SEARCH_LENGTH
  ) {
    throw new AppError(400, 'INVALID_SEARCH_QUERY', 'Search query length is invalid');
  }

  const filter: FilterQuery<UserDocument> = {
    accountStatus: 'active',
    _id: { $ne: request.currentUserId },
    normalizedDisplayName: { $regex: `^${escapePrefix(normalizedQuery)}` },
  };
  if (request.cursor) Object.assign(filter, cursorPredicate(request.cursor));
  return queryDirectory(filter, request.limit);
}