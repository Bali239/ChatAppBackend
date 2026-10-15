import { Types } from 'mongoose';
import { z } from 'zod';
import { AppError } from '../utils/error.js';

export interface PageCursor {
  createdAt: Date;
  id: Types.ObjectId;
}

const cursorPayloadSchema = z
  .object({
    createdAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
    id: z.string().regex(/^[a-f\d]{24}$/i),
  })
  .strict();

export function encodeCursor(createdAt: Date, id: string | Types.ObjectId): string {
  return Buffer.from(
    JSON.stringify({ createdAt: createdAt.toISOString(), id: id.toString() }),
  ).toString('base64url');
}

export function decodeCursor(value: string): PageCursor {
  if (!value || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new AppError(400, 'INVALID_CURSOR', 'Pagination cursor is invalid');
  }

  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== value) {
      throw new Error('Non-canonical cursor');
    }
    const payload = cursorPayloadSchema.parse(JSON.parse(decoded));
    return {
      createdAt: new Date(payload.createdAt),
      id: new Types.ObjectId(payload.id),
    };
  } catch {
    throw new AppError(400, 'INVALID_CURSOR', 'Pagination cursor is invalid');
  }
}

export function cursorPredicate(
  cursor: PageCursor,
  timestampField: 'createdAt' | 'lastActivityAt' = 'createdAt',
): Record<string, unknown> {
  return {
    $or: [
      { [timestampField]: { $lt: cursor.createdAt } },
      { [timestampField]: cursor.createdAt, _id: { $lt: cursor.id } },
    ],
  };
}