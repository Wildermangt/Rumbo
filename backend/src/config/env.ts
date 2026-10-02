import 'dotenv/config';
import { z } from 'zod';

const booleanFromString = z.enum(['true', 'false', '1', '0']).transform((value) => value === 'true' || value === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: z.string().default('*'),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(1433),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_ENCRYPT: booleanFromString.default('false'),
  DB_TRUST_SERVER_CERTIFICATE: booleanFromString.default('true'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  JWT_EXPIRES_IN: z.string().default('1h'),
  JWT_ISSUER: z.string().default('tasks-api'),

  AUTH_USERNAME: z.string().min(1).default('admin'),
  // Sin default en el código: lo aporta el entorno (docker-compose / .env).
  AUTH_PASSWORD: z.string().min(1, 'AUTH_PASSWORD es obligatorio'),

  // Adjuntos: carpeta de almacenamiento y tamaño máximo por archivo (MB).
  UPLOAD_DIR: z.string().default('uploads'),
  UPLOAD_MAX_MB: z.coerce.number().int().positive().max(50).default(5),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Valores por defecto de desarrollo que NUNCA deben usarse en producción.
 * Si aparecen con NODE_ENV=production, la API se niega a arrancar (hallazgo H-1).
 */
const INSECURE_DEFAULTS: Partial<Record<keyof Env, string[]>> = {
  JWT_SECRET: [
    'dev-only-secret-change-me-please-0123456789abcdef',
    'change-me-with-a-long-random-secret-at-least-32-chars',
  ],
  DB_PASSWORD: ['TasksApp#2024Secure'],
  // AUTH_PASSWORD no se incluye: admin/admin123 es la credencial de demo documentada
  // por el enunciado. Cámbiala por una fuerte en un despliegue real.
};

function assertProductionSecrets(env: Env): void {
  if (env.NODE_ENV !== 'production') return;
  const offending = (Object.keys(INSECURE_DEFAULTS) as (keyof Env)[]).filter((key) =>
    INSECURE_DEFAULTS[key]?.includes(String(env[key])),
  );
  if (offending.length > 0) {
    throw new Error(
      `Configuración insegura en producción: ${offending.join(', ')} conserva(n) el valor por defecto. ` +
        'Defina secretos propios (p. ej. `openssl rand -base64 48`) vía variables de entorno o un gestor de secretos.',
    );
  }
}

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // Fallar rápido: sin configuración válida la API no debe arrancar.
    throw new Error(`Variables de entorno inválidas:\n${issues}`);
  }
  assertProductionSecrets(parsed.data);
  return parsed.data;
}

export const env = loadEnv();
