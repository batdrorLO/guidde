import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AUTH_CONFIG, AuthConfigModule, type AuthConfig } from './auth.config';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { UserStore } from './user.store';

@Module({
  imports: [
    AuthConfigModule,
    JwtModule.registerAsync({
      imports: [AuthConfigModule],
      inject: [AUTH_CONFIG],
      useFactory: (cfg: AuthConfig) => ({
        secret: cfg.jwtSecret,
        signOptions: { algorithm: 'HS256', expiresIn: cfg.tokenTtlSeconds, issuer: cfg.issuer, audience: cfg.audience },
        // Pin the algorithm so a token can't pick its own (e.g. "none").
        verifyOptions: { algorithms: ['HS256'], issuer: cfg.issuer, audience: cfg.audience },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [UserStore, AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AuthModule {}
