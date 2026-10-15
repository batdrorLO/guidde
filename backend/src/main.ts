import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { ConsoleLogger, Logger, type LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter, requestLogger } from './common/http';

/**
 * LOG_LEVEL=error|warn|info|debug|verbose (default info).
 * LOG_FORMAT=json emits one JSON object per line for log shippers; default is human-readable.
 */
function logLevels(level = process.env.LOG_LEVEL ?? 'info'): LogLevel[] {
  const order: LogLevel[] = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];
  const cut = { error: 2, warn: 3, info: 4, log: 4, debug: 5, verbose: 6 }[level.toLowerCase()] ?? 4;
  return order.slice(0, cut);
}

/** Load the nearest .env above this file (repo root), if any. Real env vars take precedence. */
function loadDotEnv() {
  for (let dir = __dirname; ; dir = path.dirname(dir)) {
    const file = path.join(dir, '.env');
    if (fs.existsSync(file)) {
      const before = { ...process.env };
      process.loadEnvFile(file);
      Object.assign(process.env, before);
      return file;
    }
    if (path.dirname(dir) === dir) return null;
  }
}
const envFile = loadDotEnv();

const logger = new ConsoleLogger({
  json: process.env.LOG_FORMAT === 'json',
  logLevels: logLevels(),
});
const bootLog = new Logger('Bootstrap');

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger });
  app.setGlobalPrefix('api');
  // credentials: the browser must send the session cookie when the UI is served from another origin.
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });
  // Behind a load balancer, trust X-Forwarded-For so sign-in lockouts see real client IPs.
  if (process.env.TRUST_PROXY) app.getHttpAdapter().getInstance().set('trust proxy', process.env.TRUST_PROXY);
  app.use(requestLogger);
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  bootLog.log(
    `API listening on http://localhost:${port}/api (log level: ${process.env.LOG_LEVEL ?? 'info'}` +
      `${envFile ? `, env from ${envFile}` : ''})`,
  );
}

// Last-resort handlers: make sure nothing fails silently.
process.on('unhandledRejection', (reason) => {
  bootLog.error(`Unhandled promise rejection: ${String(reason)}`, reason instanceof Error ? reason.stack : undefined);
});
process.on('uncaughtException', (err) => {
  bootLog.fatal(`Uncaught exception, shutting down: ${err.message}`, err.stack);
  process.exit(1);
});

bootstrap().catch((err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    bootLog.fatal(
      `Port ${process.env.PORT ?? 3001} is already in use. Stop the other process or start with PORT=<free port>.`,
    );
  } else {
    bootLog.fatal(`API failed to start: ${err.message}`, err.stack);
  }
  process.exit(1);
});
