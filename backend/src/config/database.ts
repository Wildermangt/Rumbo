import sql from 'mssql';
import { env } from './env';
import { logger } from '../utils/logger';

const config: sql.config = {
  server: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  options: {
    encrypt: env.DB_ENCRYPT,
    trustServerCertificate: env.DB_TRUST_SERVER_CERTIFICATE,
    enableArithAbort: true,
  },
  pool: {
    max: env.DB_POOL_MAX,
    min: 0,
    idleTimeoutMillis: 30_000,
  },
  connectionTimeout: 15_000,
  requestTimeout: 30_000,
};

let poolPromise: Promise<sql.ConnectionPool> | null = null;

/** Devuelve un pool único (lazy). Si la conexión falla, permite reintentar en la siguiente llamada. */
export function getPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    const pool = new sql.ConnectionPool(config);
    pool.on('error', (err) => logger.error('Error en el pool de SQL Server', err));
    poolPromise = pool.connect().catch((err: unknown) => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

/** Conecta con reintentos exponenciales (útil al arrancar junto a la BD). */
export async function connectWithRetry(retries = 10, baseDelayMs = 1_000): Promise<sql.ConnectionPool> {
  for (let attempt = 1; ; attempt++) {
    try {
      const pool = await getPool();
      logger.info(`Conectado a SQL Server ${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}`);
      return pool;
    } catch (err) {
      if (attempt >= retries) throw err;
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), 15_000);
      logger.warn(`No se pudo conectar a SQL Server (intento ${attempt}/${retries}). Reintentando en ${delay} ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export async function closePool(): Promise<void> {
  if (!poolPromise) return;
  const pool = await poolPromise.catch(() => null);
  poolPromise = null;
  await pool?.close();
}

export { sql };
