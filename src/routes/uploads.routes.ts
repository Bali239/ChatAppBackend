import { Router } from 'express';
import { z } from 'zod';
import { createRequireAuth } from '../middleware/auth.js';
import {
  createAvatarUploadSignature,
  type CloudinaryCredentials,
} from '../services/avatar.service.js';
import { AppError } from '../utils/error.js';
import { sendSuccessResponse } from '../utils/response.js';
import { validateRequest } from '../utils/validate-request.js';

export function createUploadsRouter(options: {
  tokenSecret: string;
  cloudinary?: CloudinaryCredentials;
}): Router {
  const router = Router();
  router.use(createRequireAuth(options.tokenSecret));

  router.post(
    '/avatar/signature',
    validateRequest({ body: z.object({}).strict() }),
    (request, response) => {
      if (!options.cloudinary) {
        throw new AppError(503, 'AVATAR_UPLOAD_UNAVAILABLE', 'Avatar uploads are not configured');
      }
      const signature = createAvatarUploadSignature(request.user!.id, options.cloudinary);
      sendSuccessResponse(response, 200, 'Avatar upload authorized', signature);
    },
  );

  return router;
}
