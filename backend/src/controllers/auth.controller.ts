import type { Request, Response } from 'express';
import type { LoginDto } from '../schemas/auth.schema';
import type { AuthService, LoginResult } from '../services/auth.service';
import type { ApiSuccess } from '../types/api';

export function createAuthController(authService: AuthService) {
  return {
    /** POST /api/auth/login */
    login(req: Request, res: Response<ApiSuccess<LoginResult>>): void {
      const { username, password } = req.body as LoginDto;
      const result = authService.login(username, password);
      res.status(200).json({ success: true, data: result });
    },
  };
}
