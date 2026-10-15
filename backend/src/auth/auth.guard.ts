import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../common/errors';
import type { HttpRequest } from '../common/http';
import { AUTH_CONFIG, type AuthConfig } from './auth.config';
import { AuthService } from './auth.service';

const IS_PUBLIC = 'auth:isPublic';
/** Opt a route out of authentication. Everything else requires a signed-in CS user. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Registered globally: every route is protected unless marked @Public(), so a
 * new endpoint can't accidentally ship without auth.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    @Inject(AUTH_CONFIG) private readonly cfg: AuthConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;

    const req = ctx.switchToHttp().getRequest<HttpRequest>();
    const token = bearerToken(req) ?? readCookie(req, this.cfg.cookieName);
    if (!token) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        'unauthenticated',
        'Please sign in to view the Account Health dashboard.',
        'Sign in with your Customer Success account.',
      );
    }
    req.user = await this.auth.verify(token);
    return true;
  }
}

function bearerToken(req: HttpRequest): string | undefined {
  const h = req.headers.authorization;
  if (typeof h !== 'string') return undefined;
  const [scheme, value] = h.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : undefined;
}

export function readCookie(req: HttpRequest, name: string): string | undefined {
  const header = req.headers.cookie;
  if (typeof header !== 'string') return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}
