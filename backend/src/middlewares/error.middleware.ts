import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import sql from 'mssql';
import type { ApiErrorBody } from '../types/api';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';

function send(res: Response, path: string, error: AppError): void {
  const body: ApiErrorBody = {
    success: false,
    error: {
      status: error.statusCode,
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    },
    path,
    timestamp: new Date().toISOString(),
  };
  if (error.statusCode === 401) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="tasks-api"');
  }
  res.status(error.statusCode).json(body);
}

/** 404 para rutas inexistentes. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(AppError.notFound(`Ruta no encontrada: ${req.method} ${req.originalUrl}`));
};

/** Manejo centralizado de errores: toda respuesta de error tiene el mismo formato JSON. */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  const path = req.originalUrl;

  if (res.headersSent) {
    logger.error('Error tras enviar headers', err);
    res.end();
    return;
  }

  if (err instanceof AppError) {
    if (err.statusCode >= 500) logger.error(err.message, err);
    send(res, path, err);
    return;
  }

  // Errores de body-parser (JSON malformado / payload excesivo).
  const bodyParserError = err as { type?: string; status?: number };
  if (bodyParserError?.type === 'entity.parse.failed') {
    send(res, path, AppError.badRequest('El cuerpo de la solicitud no es un JSON válido'));
    return;
  }
  if (bodyParserError?.type === 'entity.too.large') {
    send(res, path, new AppError(413, 'BAD_REQUEST', 'El cuerpo de la solicitud es demasiado grande'));
    return;
  }

  if (err instanceof sql.ConnectionError) {
    logger.error('Base de datos no disponible', err);
    send(res, path, new AppError(503, 'SERVICE_UNAVAILABLE', 'Base de datos no disponible, intente más tarde'));
    return;
  }

  logger.error(`Error no controlado en ${req.method} ${path}`, err);
  send(res, path, new AppError(500, 'INTERNAL_SERVER_ERROR', 'Error interno del servidor'));
};
