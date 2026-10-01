import type { AuthUser } from '../services/auth.service';

declare global {
  namespace Express {
    interface Request {
      /** Usuario autenticado, poblado por authMiddleware. */
      user?: AuthUser;
    }
  }
}

export {};
