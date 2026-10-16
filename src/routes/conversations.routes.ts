import { Router } from 'express';
import { z } from 'zod';
import { createRequireAuth } from '../middleware/auth.js';
import { findOrCreateDirectConversation } from '../services/conversation.service.js';
import { listConversationsForUser } from '../services/conversation-list.service.js';
import {
  clearConversationForUser,
  getVisibleMessageHistory,
  markConversationRead,
} from '../services/message-history.service.js';
import { sendSuccessResponse } from '../utils/response.js';
import { validateRequest } from '../utils/validate-request.js';

const conversationIdParamsSchema = z.object({
  conversationId: z.string().regex(/^[a-f\d]{24}$/i),
}).strict();

const directUserParamsSchema = z.object({
  userId: z.string().regex(/^[a-f\d]{24}$/i),
}).strict();

const pageQuerySchema = z.object({
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
}).strict();

const readPositionSchema = z.object({
  messageId: z.string().regex(/^[a-f\d]{24}$/i),
}).strict();

export function createConversationsRouter(tokenSecret: string): Router {
  const router = Router();
  router.use(createRequireAuth(tokenSecret));

  router.get('/', validateRequest({ query: pageQuerySchema }), async (request, response) => {
    const query = response.locals.validated.query as z.infer<typeof pageQuerySchema>;
    const page = await listConversationsForUser({
      userId: request.user!.id,
      cursor: query.cursor,
      limit: query.limit,
    });
    sendSuccessResponse(response, 200, 'Conversations retrieved', page);
  });

  router.post(
    '/direct/:userId',
    validateRequest({ params: directUserParamsSchema, body: z.object({}).strict() }),
    async (_request, response) => {
      const { userId } = response.locals.validated.params as z.infer<typeof directUserParamsSchema>;
      const requesterId = _request.user!.id;
      const conversation = await findOrCreateDirectConversation(requesterId, userId);
      sendSuccessResponse(response, 200, 'Direct conversation ready', {
        conversationId: conversation._id.toString(),
      });
    },
  );

  router.get(
    '/:conversationId/messages',
    validateRequest({ params: conversationIdParamsSchema, query: pageQuerySchema }),
    async (request, response) => {
      const { conversationId } = response.locals.validated.params as z.infer<typeof conversationIdParamsSchema>;
      const query = response.locals.validated.query as z.infer<typeof pageQuerySchema>;
      const page = await getVisibleMessageHistory({
        userId: request.user!.id,
        conversationId,
        cursor: query.cursor,
        limit: query.limit,
      });
      sendSuccessResponse(response, 200, 'Messages retrieved', page);
    },
  );

  router.post(
    '/:conversationId/clear',
    validateRequest({ params: conversationIdParamsSchema, body: z.object({}).strict() }),
    async (request, response) => {
      const { conversationId } = response.locals.validated.params as z.infer<typeof conversationIdParamsSchema>;
      const result = await clearConversationForUser(request.user!.id, conversationId);
      sendSuccessResponse(response, 200, 'Your conversation history was cleared', result);
    },
  );

  router.post(
    '/:conversationId/read',
    validateRequest({ params: conversationIdParamsSchema, body: readPositionSchema }),
    async (request, response) => {
      const { conversationId } = response.locals.validated.params as z.infer<typeof conversationIdParamsSchema>;
      const { messageId } = response.locals.validated.body as z.infer<typeof readPositionSchema>;
      const result = await markConversationRead(request.user!.id, conversationId, messageId);
      sendSuccessResponse(response, 200, 'Read position updated', result);
    },
  );

  return router;
}
