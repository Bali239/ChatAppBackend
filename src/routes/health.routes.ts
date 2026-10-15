import { Router } from 'express';
import type { DatabaseStatus } from '../config/database.js';
import { createHealthController } from '../controllers/health.controller.js';

export function createHealthRouter(getStatus: () => DatabaseStatus): Router {
  const router = Router();
  router.get('/health', createHealthController(getStatus));
  return router;
}