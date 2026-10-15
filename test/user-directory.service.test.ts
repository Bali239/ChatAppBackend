import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { User } from '../src/models/user.model.js';
import { decodeCursor, encodeCursor } from '../src/services/cursor.js';
import { listEligibleUsers, searchEligibleUsers } from '../src/services/user-directory.service.js';

function makeQuery(results: object[]) {
  const query = {
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(results),
  };
  return query;
}

afterEach(() => vi.restoreAllMocks());

describe('user directory service', () => {
  it('excludes the current and ineligible users and applies a bounded stable page', async () => {
    const currentUserId = new Types.ObjectId().toString();
    const registeredAt = new Date('2026-10-01T00:00:00.000Z');
    const resultUserId = new Types.ObjectId();
    const query = makeQuery([
      {
        _id: resultUserId,
        displayName: 'Taylor Example',
        email: 'taylor@example.com',
        avatarUrl: null,
        createdAt: registeredAt,
      },
    ]);
    vi.spyOn(User, 'find').mockReturnValue(query as never);

    const page = await listEligibleUsers({ userId: currentUserId, limit: 10 });

    expect(User.find).toHaveBeenCalledWith({
      accountStatus: 'active',
      _id: { $ne: new Types.ObjectId(currentUserId) },
    });
    expect(query.select).toHaveBeenCalledWith('_id displayName email avatarUrl createdAt');
    expect(query.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(query.limit).toHaveBeenCalledWith(11);
    expect(page.users[0]).toEqual({
      id: resultUserId.toString(),
      displayName: 'Taylor Example',
      email: 'taylor@example.com',
      avatarUrl: null,
      isOnline: false,
      createdAt: registeredAt,
    });
  });

  it('normalizes search and uses an escaped, indexed prefix with a stable cursor', async () => {
    const currentUserId = new Types.ObjectId().toString();
    const cursorTime = new Date('2026-09-01T00:00:00.000Z');
    const cursorId = new Types.ObjectId();
    const query = makeQuery([]);
    vi.spyOn(User, 'find').mockReturnValue(query as never);

    await searchEligibleUsers({
      userId: currentUserId,
      query: '  Jane.* ',
      cursor: encodeCursor(cursorTime, cursorId),
    });

    expect(User.find).toHaveBeenCalledWith({
      accountStatus: 'active',
      _id: { $ne: new Types.ObjectId(currentUserId) },
      normalizedDisplayName: { $regex: '^jane\\.\\*' },
      $or: [
        { createdAt: { $lt: cursorTime } },
        { createdAt: cursorTime, _id: { $lt: cursorId } },
      ],
    });
    expect(query.limit).toHaveBeenCalledWith(21);
  });

  it('rejects short searches and malformed cursors', async () => {
    const userId = new Types.ObjectId().toString();

    await expect(searchEligibleUsers({ userId, query: ' a ' })).rejects.toMatchObject({
      code: 'INVALID_SEARCH_QUERY',
    });
    await expect(listEligibleUsers({ userId, cursor: 'not-a-cursor' })).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
    });
  });

  it('round-trips cursors without losing timestamp or ObjectId precision', () => {
    const date = new Date('2026-10-15T08:30:42.123Z');
    const id = new Types.ObjectId();
    const decoded = decodeCursor(encodeCursor(date, id));

    expect(decoded.createdAt.toISOString()).toBe(date.toISOString());
    expect(decoded.id.toString()).toBe(id.toString());
  });
});