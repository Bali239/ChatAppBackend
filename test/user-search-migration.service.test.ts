import { afterEach, describe, expect, it, vi } from 'vitest';
import { User } from '../src/models/user.model.js';
import { backfillNormalizedDisplayNames } from '../src/services/user-search-migration.service.js';

afterEach(() => vi.restoreAllMocks());

describe('normalized user search migration', () => {
  it('backfills missing normalized names in bounded idempotent batches', async () => {
    const findQuery = {
      select: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn()
        .mockResolvedValueOnce([{ _id: 'user-1', displayName: ' Jane Doe ' }])
        .mockResolvedValueOnce([]),
    };
    vi.spyOn(User, 'find').mockReturnValue(findQuery as never);
    const bulkWrite = vi.spyOn(User, 'bulkWrite').mockResolvedValue({
      acknowledged: true,
      insertedCount: 0,
      matchedCount: 1,
      modifiedCount: 1,
      deletedCount: 0,
      upsertedCount: 0,
      upsertedIds: {},
    } as never);

    await expect(backfillNormalizedDisplayNames(25)).resolves.toBe(1);

    expect(findQuery.limit).toHaveBeenCalledWith(25);
    expect(bulkWrite).toHaveBeenCalledWith([
      expect.objectContaining({
        updateOne: expect.objectContaining({
          update: { $set: { normalizedDisplayName: 'jane doe' } },
        }),
      }),
    ], { ordered: false });
  });

  it('rejects unbounded or invalid batch sizes', async () => {
    await expect(backfillNormalizedDisplayNames(0)).rejects.toThrow(/batch size/);
    await expect(backfillNormalizedDisplayNames(1_001)).rejects.toThrow(/batch size/);
  });
});