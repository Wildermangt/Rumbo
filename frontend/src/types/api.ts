export interface ApiSuccess<T, M = undefined> {
  success: true;
  data: T;
  meta?: M;
}

export interface ApiErrorDetail {
  field: string;
  message: string;
}

export interface ApiErrorBody {
  success: false;
  error: {
    status: number;
    code: string;
    message: string;
    details?: ApiErrorDetail[];
  };
  path: string;
  timestamp: string;
}

export interface LoginResponse {
  token: string;
  tokenType: 'Bearer';
  expiresIn: string;
  user: { username: string; role: string };
}
