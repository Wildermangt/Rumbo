import type { RequestHandler } from 'express';
import type { AuthService } from '../services/auth.service';
import { AppError } from '../utils/AppError';

const BEARER_PATTERN = /^Bearer\s+([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/;

/** Verifica `Authorization: Bearer <token>` y adjunta el usuario a `req.user`. */
export function createAuthMiddleware(authService: AuthService): RequestHandler {
  return function authMiddleware(req, _res, next) {
    const header = req.headers.authorization;
    if (!header) {
      next(AppError.unauthorized('Falta el header Authorization'));
      return;
    }

    const match = BEARER_PATTERN.exec(header.trim());
    if (!match?.[1]) {
      next(AppError.unauthorized('Formato esperado: Authorization: Bearer <token>'));
      return;
    }

    try {
      req.user = authService.verifyToken(match[1]);
      next();
    } catch (err) {
      next(err);
    }
  };
}
