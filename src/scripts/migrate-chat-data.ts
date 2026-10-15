import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { loadEnvironment } from '../config/env.js';
import { Conversation } from '../models/conversation.model.js';
import { ConversationMember } from '../models/conversation-member.model.js';
import { Message } from '../models/message.model.js';
import { User } from '../models/user.model.js';
import { backfillNormalizedDisplayNames } from '../services/user-search-migration.service.js';
import { createLogger } from '../utils/logger.js';

async function runMigration(): Promise<void> {
  const environment = loadEnvironment();
  const logger = createLogger(environment.LOG_LEVEL);
  await connectDatabase(environment.MONGODB_URI, logger);

  try {
    const normalizedUsers = await backfillNormalizedDisplayNames();
    await Promise.all([
      User.createIndexes(),
      Conversation.createIndexes(),
      ConversationMember.createIndexes(),
      Message.createIndexes(),
    ]);
    logger.info({ normalizedUsers }, 'Chat data migration complete');
  } finally {
    await disconnectDatabase(logger);
  }
}

void runMigration().catch((error: unknown) => {
  const logger = createLogger();
  logger.fatal(
    { errorType: error instanceof Error ? error.name : 'UnknownError' },
    'Chat data migration failed',
  );
  process.exitCode = 1;
});