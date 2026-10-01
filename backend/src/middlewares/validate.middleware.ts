import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';
import { AppError, type ErrorDetail } from '../utils/AppError';

interface RequestSchemas {
  params?: ZodTypeAny;
  query?: ZodTypeAny;
  body?: ZodTypeAny;
}

/**
 * Valida y normaliza params, query y body con Zod.
 * Reemplaza los valores originales por los parseados (tipados, con defaults y coerción)
 * y agrega TODOS los errores en una sola respuesta 400.
 */
export function validate(schemas: RequestSchemas): RequestHandler {
  return (req, _res, next) => {
    const details: ErrorDetail[] = [];

    for (const key of ['params', 'query', 'body'] as const) {
      const schema = schemas[key];
      if (!schema) continue;

      const result = schema.safeParse(req[key]);
      if (result.success) {
        (req as unknown as Record<string, unknown>)[key] = result.data;
      } else {
        for (const issue of result.error.issues) {
          const field = issue.path.length > 0 ? `${key}.${issue.path.join('.')}` : key;
          const message =
            issue.code === 'unrecognized_keys' ? `Campos no permitidos: ${issue.keys.join(', ')}` : issue.message;
          details.push({ field, message });
        }
      }
    }

    if (details.length > 0) {
      next(new AppError(400, 'VALIDATION_ERROR', 'La solicitud contiene datos inválidos', details));
      return;
    }
    next();
  };
}
