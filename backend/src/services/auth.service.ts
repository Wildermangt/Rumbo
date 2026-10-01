import { createHash, timingSafeEqual } from 'node:crypto';
import jwt, { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import { AppError } from '../utils/AppError';

export interface AuthUser {
  username: string;
  role: 'admin';
}

export interface AuthConfig {
  username: string;
  password: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  jwtIssuer: string;
}

export interface LoginResult {
  token: string;
  tokenType: 'Bearer';
  expiresIn: string;
  user: AuthUser;
}

interface TokenPayload extends jwt.JwtPayload {
  sub: string;
  role: AuthUser['role'];
}

/** Comparación en tiempo constante (evita ataques de temporización). */
function safeEqual(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

export class AuthService {
  constructor(private readonly config: AuthConfig) {}

  login(username: string, password: string): LoginResult {
    // Evaluar ambos lados siempre, para no filtrar si el usuario existe.
    const validUser = safeEqual(username, this.config.username);
    const validPassword = safeEqual(password, this.config.password);
    if (!validUser || !validPassword) {
      throw AppError.unauthorized('Usuario o contraseña incorrectos', 'INVALID_CREDENTIALS');
    }

    const user: AuthUser = { username, role: 'admin' };
    const token = jwt.sign({ role: user.role }, this.config.jwtSecret, {
      algorithm: 'HS256',
      subject: user.username,
      issuer: this.config.jwtIssuer,
      expiresIn: this.config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
    });

    return { token, tokenType: 'Bearer', expiresIn: this.config.jwtExpiresIn, user };
  }

  verifyToken(token: string): AuthUser {
    try {
      const payload = jwt.verify(token, this.config.jwtSecret, {
        algorithms: ['HS256'],
        issuer: this.config.jwtIssuer,
      }) as TokenPayload;

      if (!payload.sub || payload.role !== 'admin') {
        throw AppError.unauthorized('Token con claims inválidos');
      }
      return { username: payload.sub, role: payload.role };
    } catch (err) {
      if (err instanceof TokenExpiredError) {
        throw AppError.unauthorized('El token ha expirado', 'TOKEN_EXPIRED');
      }
      if (err instanceof JsonWebTokenError) {
        throw AppError.unauthorized('Token inválido');
      }
      throw err;
    }
  }
}
