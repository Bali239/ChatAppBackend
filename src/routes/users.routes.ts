import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { Types } from 'mongoose';
import { z } from 'zod';
import { type CloudinaryCredentials, updateUserProfile } from '../services/avatar.service.js';
import { listEligibleUsers, searchEligibleUsers } from '../services/user-directory.service.js';
import { isUserOnline } from '../realtime/presence.js';
import { createRequireAuth } from '../middleware/auth.js';
import { User } from '../models/user.model.js';
import { AppError } from '../utils/error.js';
import type { AppLogger } from '../utils/logger.js';
import { sendSuccessResponse } from '../utils/response.js';
import { validateRequest } from '../utils/validate-request.js';

const cursorQuerySchema = z.object({
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
}).strict();

const searchQuerySchema = cursorQuerySchema.extend({
  q: z.string().max(160),
}).strict();

const userIdParamsSchema = z.object({
  userId: z.string().regex(/^[a-f\d]{24}$/i),
}).strict();

const profileUpdateSchema = z.object({
  displayName: z.string()
    .trim()
    .min(2)
    .max(80)
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'Display name contains invalid characters')
    .transform((value) => value.replace(/\s+/g, ' '))
    .optional(),
  avatarPublicId: z.string()
    .regex(/^(?:avatar-[a-f\d-]{36}|chatapp\/avatars\/[a-f\d]{64}\/avatar-[a-f\d-]{36})$/)
    .optional(),
}).strict().refine(
  (value) => value.displayName !== undefined || value.avatarPublicId !== undefined,
  'At least one editable profile field is required',
);

const searchRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

export function createUsersRouter(options: {
  tokenSecret: string;
  cloudinary?: CloudinaryCredentials;
  logger: AppLogger;
}): Router {
  const router = Router();
  router.use(createRequireAuth(options.tokenSecret));

  router.get('/', validateRequest({ query: cursorQuerySchema }), async (request, response) => {
    const query = response.locals.validated.query as z.infer<typeof cursorQuerySchema>;
    const page = await listEligibleUsers({
      userId: request.user!.id,
      cursor: query.cursor,
      limit: query.limit,
    });
    sendSuccessResponse(response, 200, 'Users retrieved', page);
  });

  router.get('/search', searchRateLimit, validateRequest({ query: searchQuerySchema }), async (request, response) => {
    const query = response.locals.validated.query as z.infer<typeof searchQuerySchema>;
    const page = await searchEligibleUsers({
      userId: request.user!.id,
      query: query.q,
      cursor: query.cursor,
      limit: query.limit,
    });
    sendSuccessResponse(response, 200, 'Search results retrieved', page);
  });

  router.get('/:userId', validateRequest({ params: userIdParamsSchema }), async (_request, response) => {
    const { userId } = response.locals.validated.params as z.infer<typeof userIdParamsSchema>;
    const user = await User.findOne({ _id: new Types.ObjectId(userId), accountStatus: 'active' })
      .select('_id displayName email avatarUrl')
      .lean();
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User was not found');

    sendSuccessResponse(response, 200, 'User profile retrieved', {
      user: {
        id: user._id.toString(),
        displayName: user.displayName,
        email: user.email,
        avatarUrl: user.avatarUrl ?? null,
        isOnline: isUserOnline(user._id.toString()),
      },
    });
  });

  router.patch(
    '/me/profile',
    validateRequest({ body: profileUpdateSchema }),
    async (request, response) => {
      const body = response.locals.validated.body as z.infer<typeof profileUpdateSchema>;
      const user = await updateUserProfile({
        userId: request.user!.id,
        displayName: body.displayName,
        avatarPublicId: body.avatarPublicId,
        credentials: options.cloudinary,
        logger: options.logger,
      });
      const io = request.app.get('io') as import('../realtime/events.js').ChatSocketServer | undefined;
      io?.emit('profile:updated', {
        id: user.id,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl ?? null,
      });
      sendSuccessResponse(response, 200, 'Profile updated', { user });
    },
  );

  return router;
}
