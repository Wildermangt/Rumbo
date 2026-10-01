import { Router } from 'express';
import { createAuthMiddleware } from '../middlewares/auth.middleware';
import type { AuthService } from '../services/auth.service';
import type { TaskService } from '../services/task.service';
import { asyncHandler } from '../utils/asyncHandler';
import { createAuthRouter } from './auth.routes';
import { createTaskRouter } from './task.routes';

export interface ApiDependencies {
  authService: AuthService;
  taskService: TaskService;
  /** Devuelve true si la base de datos responde. */
  healthCheck: () => Promise<boolean>;
}

export function createApiRouter({ authService, taskService, healthCheck }: ApiDependencies): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(authService);

  // Público: usado por el HEALTHCHECK de Docker.
  router.get(
    '/health',
    asyncHandler(async (_req, res) => {
      const dbUp = await healthCheck().catch(() => false);
      res.status(dbUp ? 200 : 503).json({
        success: dbUp,
        data: { status: dbUp ? 'ok' : 'degraded', database: dbUp ? 'up' : 'down', uptime: process.uptime() },
      });
    }),
  );

  router.use('/auth', createAuthRouter(authService));
  router.use('/tasks', authMiddleware, createTaskRouter(taskService));

  return router;
}
