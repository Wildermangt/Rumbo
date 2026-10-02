import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware';
import { createApiRouter, type ApiDependencies } from './routes';

export interface AppOptions extends ApiDependencies {
  corsOrigin: string;
}

/** Construye la aplicación Express. Las dependencias se inyectan (composition root en server.ts). */
export function createApp({ corsOrigin, ...deps }: AppOptions): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // detrás de nginx: IP real para rate limiting

  app.use(helmet());
  app.use(
    cors({
      origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((o) => o.trim()),
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  app.use('/api', createApiRouter(deps));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
