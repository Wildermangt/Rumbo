import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createAuthController } from '../controllers/auth.controller';
import { validate } from '../middlewares/validate.middleware';
import { loginBodySchema } from '../schemas/auth.schema';
import type { AuthService } from '../services/auth.service';
import { AppError } from '../utils/AppError';

export function createAuthRouter(authService: AuthService): Router {
  const router = Router();
  const controller = createAuthController(authService);

  // Mitiga fuerza bruta sobre el login.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new AppError(429, 'TOO_MANY_REQUESTS', 'Demasiados intentos de inicio de sesión, intente más tarde'));
    },
  });

  router.post('/login', loginLimiter, validate({ body: loginBodySchema }), controller.login);

  return router;
}
