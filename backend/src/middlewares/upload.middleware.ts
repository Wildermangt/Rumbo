import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { env } from '../config/env';

// Carpeta de almacenamiento (se crea si no existe).
export const UPLOAD_DIR = path.isAbsolute(env.UPLOAD_DIR)
  ? env.UPLOAD_DIR
  : path.resolve(process.cwd(), env.UPLOAD_DIR);
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    // Nombre único en disco; conservamos solo la extensión del original.
    const ext = path
      .extname(file.originalname)
      .slice(0, 12)
      .replace(/[^.\w]/g, '');
    cb(null, `${randomUUID()}${ext}`);
  },
});

/** Un archivo por petición, bajo el campo "file", con límite de tamaño configurable. */
export const uploadSingle = multer({
  storage,
  limits: { fileSize: env.UPLOAD_MAX_MB * 1024 * 1024, files: 1 },
}).single('file');
