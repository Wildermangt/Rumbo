import { createApp } from './app';
import { closePool, connectWithRetry, getPool } from './config/database';
import { env } from './config/env';
import { SqlTaskRepository } from './repositories/task.repository';
import { AuthService } from './services/auth.service';
import { TaskService } from './services/task.service';
import { logger } from './utils/logger';

async function bootstrap(): Promise<void> {
  await connectWithRetry();

  // Composition root: aquí se cablean las capas.
  const authService = new AuthService({
    username: env.AUTH_USERNAME,
    password: env.AUTH_PASSWORD,
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN,
    jwtIssuer: env.JWT_ISSUER,
  });
  const taskService = new TaskService(new SqlTaskRepository());

  const app = createApp({
    corsOrigin: env.CORS_ORIGIN,
    authService,
    taskService,
    healthCheck: async () => {
      const pool = await getPool();
      await pool.request().query('SELECT 1 AS ok');
      return true;
    },
  });

  const server = app.listen(env.PORT, () => {
    logger.info(`API escuchando en http://0.0.0.0:${env.PORT} (${env.NODE_ENV})`);
  });

  const shutdown = (signal: string) => {
    logger.info(`${signal} recibido, cerrando servidor...`);
    server.close(async () => {
      await closePool().catch((err) => logger.error('Error cerrando el pool', err));
      logger.info('Servidor detenido');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (reason) => logger.error('unhandledRejection', reason));

bootstrap().catch((err) => {
  logger.error('No se pudo iniciar la API', err);
  process.exit(1);
});
