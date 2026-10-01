type Level = 'debug' | 'info' | 'warn' | 'error';

function write(level: Level, message: string, meta?: unknown): void {
  const entry: Record<string, unknown> = { ts: new Date().toISOString(), level, message };
  if (meta instanceof Error) {
    entry.error = { name: meta.name, message: meta.message, stack: meta.stack };
  } else if (meta !== undefined) {
    entry.meta = meta;
  }
  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

/** Logger estructurado en JSON (amigable con `docker logs` y agregadores). */
export const logger = {
  debug: (message: string, meta?: unknown) => {
    if (process.env.NODE_ENV === 'development') write('debug', message, meta);
  },
  info: (message: string, meta?: unknown) => write('info', message, meta),
  warn: (message: string, meta?: unknown) => write('warn', message, meta),
  error: (message: string, meta?: unknown) => write('error', message, meta),
};
