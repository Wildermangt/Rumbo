import { z } from 'zod';

/** POST /api/auth/login */
export const loginBodySchema = z
  .object({
    username: z
      .string({ required_error: 'username es obligatorio', invalid_type_error: 'username debe ser texto' })
      .trim()
      .min(1, 'username es obligatorio')
      .max(100),
    password: z
      .string({ required_error: 'password es obligatorio', invalid_type_error: 'password debe ser texto' })
      .min(1, 'password es obligatorio')
      .max(200),
  })
  .strict();

export type LoginDto = z.infer<typeof loginBodySchema>;
