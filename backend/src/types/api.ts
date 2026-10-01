import type { ErrorCode, ErrorDetail } from '../utils/AppError';

/** Envoltorio uniforme de respuestas exitosas. */
export interface ApiSuccess<T, M = undefined> {
  success: true;
  data: T;
  meta?: M;
}

/** Envoltorio uniforme de respuestas de error. */
export interface ApiErrorBody {
  success: false;
  error: {
    status: number;
    code: ErrorCode;
    message: string;
    details?: ErrorDetail[];
  };
  path: string;
  timestamp: string;
}
