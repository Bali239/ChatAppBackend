import { User, normalizeDisplayName } from '../models/user.model.js';

const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 1_000;

export async function backfillNormalizedDisplayNames(batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error('Migration batch size is invalid');
  }

  let updatedCount = 0;
  while (true) {
    const users = await User.find({
      $or: [
        { normalizedDisplayName: { $exists: false } },
        { normalizedDisplayName: null },
        { normalizedDisplayName: '' },
      ],
    })
      .select('_id displayName')
      .sort({ _id: 1 })
      .limit(batchSize)
      .lean();
    if (users.length === 0) return updatedCount;

    const result = await User.bulkWrite(
      users.map((user) => ({
        updateOne: {
          filter: {
            _id: user._id,
            $or: [
              { normalizedDisplayName: { $exists: false } },
              { normalizedDisplayName: null },
              { normalizedDisplayName: '' },
            ],
          },
          update: { $set: { normalizedDisplayName: normalizeDisplayName(user.displayName) } },
        },
      })),
      { ordered: false },
    );
    updatedCount += result.modifiedCount;
  }
}