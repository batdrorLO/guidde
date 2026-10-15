import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { AppException } from '../common/errors';
import { AUTH_CONFIG, type AuthConfig } from './auth.config';
import { UserStore, type AuthUser } from './user.store';

interface TokenPayload {
  sub: string;
  name: string;
  role: string;
}

export interface LoginResult {
  user: AuthUser;
  token: string;
  expiresAt: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly failures = new Map<string, { count: number; firstAt: number }>();
  /**
   * Compared against when the email is unknown, so "no such user" takes as long as
   * "wrong password" and response times don't reveal which emails exist.
   */
  private readonly dummyHash = bcrypt.hashSync(randomBytes(16).toString('hex'), 10);

  constructor(
    @Inject(AUTH_CONFIG) private readonly cfg: AuthConfig,
    private readonly users: UserStore,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string, ip: string): Promise<LoginResult> {
    const normalized = email.trim().toLowerCase();
    const key = `${ip}|${normalized}`;
    this.assertNotLocked(key, normalized, ip);

    const stored = this.users.find(normalized);
    const passwordOk = await bcrypt.compare(password, stored?.passwordHash ?? this.dummyHash);
    if (!stored || !passwordOk) {
      this.recordFailure(key);
      this.logger.warn(`Failed sign-in for ${normalized} from ${ip} (${stored ? 'wrong password' : 'unknown user'})`);
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        'invalid_credentials',
        'The email or password is incorrect.',
        "Check for typos. If you've forgotten your password, ask the dashboard admin to reset it.",
      );
    }
    this.failures.delete(key);

    // The password is right, so it's safe to say why they can't come in.
    if (!this.isAllowed(stored.role)) {
      this.logger.warn(`Refused sign-in for ${normalized}: role "${stored.role}" has no dashboard access`);
      throw accessDenied();
    }

    const user: AuthUser = { email: stored.email, name: stored.name, role: stored.role };
    const token = await this.jwt.signAsync({ sub: user.email, name: user.name, role: user.role } satisfies TokenPayload);
    this.logger.log(`Signed in ${user.email} (${user.role}) from ${ip}`);
    return { user, token, expiresAt: new Date(Date.now() + this.cfg.tokenTtlSeconds * 1000).toISOString() };
  }

  /** Validates a token and returns the current user, or throws a 401/403 the UI can show. */
  async verify(token: string): Promise<AuthUser> {
    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(token);
    } catch (err) {
      if ((err as Error).name === 'TokenExpiredError') {
        throw new AppException(HttpStatus.UNAUTHORIZED, 'session_expired', 'Your session has expired.', 'Sign in again to continue.');
      }
      this.logger.warn(`Rejected invalid token: ${(err as Error).message}`);
      throw new AppException(HttpStatus.UNAUTHORIZED, 'invalid_session', 'Your session is not valid.', 'Sign in again to continue.');
    }

    // Check the user file, not just the token: removing someone or changing their
    // role takes effect on their next request instead of when the token expires.
    const stored = this.users.find(payload.sub);
    if (!stored) {
      this.logger.warn(`Rejected token for ${payload.sub}: no longer in the users file`);
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        'account_removed',
        'Your account no longer has access to this dashboard.',
        'Ask the dashboard admin if you think this is a mistake.',
      );
    }
    if (!this.isAllowed(stored.role)) throw accessDenied();
    return { email: stored.email, name: stored.name, role: stored.role };
  }

  private isAllowed(role: string) {
    return this.cfg.allowedRoles.includes(role);
  }

  private assertNotLocked(key: string, email: string, ip: string) {
    const f = this.failures.get(key);
    if (!f) return;
    const windowMs = this.cfg.lockoutMinutes * 60_000;
    const elapsed = Date.now() - f.firstAt;
    if (elapsed > windowMs) {
      this.failures.delete(key);
      return;
    }
    if (f.count >= this.cfg.maxFailedLogins) {
      const minutes = Math.ceil((windowMs - elapsed) / 60_000);
      this.logger.warn(`Blocked sign-in for ${email} from ${ip}: too many failed attempts`);
      throw new AppException(
        HttpStatus.TOO_MANY_REQUESTS,
        'too_many_attempts',
        'Too many failed sign-in attempts.',
        `For security, sign-in is paused for this account. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      );
    }
  }

  private recordFailure(key: string) {
    // Bound memory if someone sprays random emails: drop entries whose window has passed.
    if (this.failures.size > 10_000) {
      const cutoff = Date.now() - this.cfg.lockoutMinutes * 60_000;
      for (const [k, v] of this.failures) if (v.firstAt < cutoff) this.failures.delete(k);
    }
    const f = this.failures.get(key);
    if (f) f.count++;
    else this.failures.set(key, { count: 1, firstAt: Date.now() });
  }
}

function accessDenied() {
  return new AppException(
    HttpStatus.FORBIDDEN,
    'access_denied',
    "Your account doesn't have access to the Account Health dashboard.",
    'Access is limited to the Customer Success team. Ask the dashboard admin if you need it.',
  );
}
