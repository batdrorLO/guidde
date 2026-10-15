import { Logger, Module } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface AuthConfig {
  jwtSecret: string;
  tokenTtlSeconds: number;
  usersFile: string;
  /** Roles allowed into the dashboard. Everyone else is refused, even with a valid password. */
  allowedRoles: string[];
  cookieName: string;
  cookieSecure: boolean;
  issuer: string;
  audience: string;
  /** Failed sign-ins per (IP, email) before a temporary lockout. */
  maxFailedLogins: number;
  lockoutMinutes: number;
}

export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

/**
 * Reads auth settings from the environment. Misconfiguration is a startup error:
 * running with no users file, or with a weak secret in production, is worse than not running.
 */
export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const log = new Logger('AuthConfig');
  const prod = env.NODE_ENV === 'production';

  let jwtSecret = env.JWT_SECRET ?? '';
  if (!jwtSecret) {
    if (prod) throw new Error('JWT_SECRET must be set in production (at least 32 random characters).');
    jwtSecret = randomBytes(48).toString('base64url');
    log.warn(
      'JWT_SECRET is not set, so a random secret is used for this run: everyone is signed out when the API restarts. ' +
        'Set JWT_SECRET in .env (see .env.example).',
    );
  } else if (jwtSecret.length < 32) {
    if (prod) throw new Error('JWT_SECRET is too short; use at least 32 random characters.');
    log.warn('JWT_SECRET is shorter than 32 characters. Fine for local development, not for production.');
  }

  const ttlHours = Number(env.JWT_TTL_HOURS ?? 8);
  if (!Number.isFinite(ttlHours) || ttlHours <= 0) throw new Error(`JWT_TTL_HOURS must be a positive number, got "${env.JWT_TTL_HOURS}".`);

  const allowedRoles = (env.AUTH_ALLOWED_ROLES ?? 'cs,admin')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  if (allowedRoles.length === 0) throw new Error('AUTH_ALLOWED_ROLES is empty, so nobody could sign in.');

  return {
    jwtSecret,
    tokenTtlSeconds: Math.round(ttlHours * 3600),
    usersFile: resolveUsersFile(env.AUTH_USERS_FILE),
    allowedRoles,
    cookieName: 'ah_session',
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : prod,
    issuer: 'account-health-api',
    audience: 'account-health-dashboard',
    maxFailedLogins: 5,
    lockoutMinutes: 15,
  };
}

/** AUTH_USERS_FILE, else the nearest `config/users.json` above this file (works from src/ and dist/). */
function resolveUsersFile(fromEnv?: string): string {
  if (fromEnv) return path.resolve(fromEnv);
  let dir = __dirname;
  for (;;) {
    const candidate = path.join(dir, 'config', 'users.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        'No users file found, so nobody could sign in. Create config/users.json (npm run user -w backend -- add …) or set AUTH_USERS_FILE.',
      );
    }
    dir = parent;
  }
}

@Module({
  providers: [{ provide: AUTH_CONFIG, useFactory: () => loadAuthConfig() }],
  exports: [AUTH_CONFIG],
})
export class AuthConfigModule {}
