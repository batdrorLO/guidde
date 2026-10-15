import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import { z } from 'zod';
import { AppException } from '../common/errors';
import type { HttpRequest } from '../common/http';
import { AUTH_CONFIG, type AuthConfig } from './auth.config';
import { Public } from './auth.guard';
import { AuthService } from './auth.service';

const loginBody = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(200),
});

interface CookieOptions {
  httpOnly: boolean;
  sameSite: 'strict';
  secure: boolean;
  path: string;
  maxAge?: number;
}
interface CookieResponse {
  cookie(name: string, value: string, options: CookieOptions): void;
  clearCookie(name: string, options: CookieOptions): void;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(AUTH_CONFIG) private readonly cfg: AuthConfig,
  ) {}

  /**
   * POST /api/auth/login {email, password}
   * Sets the JWT in an httpOnly cookie for the browser (JavaScript can't read it, so
   * an XSS bug can't steal it). The token is also returned for API clients / curl,
   * which send it as `Authorization: Bearer <token>`.
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: unknown, @Req() req: HttpRequest, @Res({ passthrough: true }) res: CookieResponse) {
    const parsed = loginBody.safeParse(body);
    if (!parsed.success) {
      throw new AppException(HttpStatus.BAD_REQUEST, 'invalid_login_request', 'Enter your email and password.');
    }
    const result = await this.auth.login(parsed.data.email, parsed.data.password, req.ip ?? 'unknown');
    res.cookie(this.cfg.cookieName, result.token, { ...this.cookieOptions(), maxAge: this.cfg.tokenTtlSeconds * 1000 });
    return { user: result.user, expiresAt: result.expiresAt, accessToken: result.token };
  }

  /** Public so an expired session can still clear its cookie. */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) res: CookieResponse) {
    res.clearCookie(this.cfg.cookieName, this.cookieOptions());
    return { ok: true };
  }

  /** The signed-in user; 401 if there is none. The UI calls this on load. */
  @Get('me')
  me(@Req() req: HttpRequest) {
    return { user: req.user };
  }

  private cookieOptions(): CookieOptions {
    // SameSite=Strict: the browser never sends the cookie on cross-site requests (CSRF protection).
    return { httpOnly: true, sameSite: 'strict', secure: this.cfg.cookieSecure, path: '/api' };
  }
}
