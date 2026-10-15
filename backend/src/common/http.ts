import { randomUUID } from 'node:crypto';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AppException, type ErrorBody } from './errors';

// Minimal shapes of the Express objects we touch (avoids pulling in @types/express).
export interface HttpRequest {
  method: string;
  originalUrl: string;
  headers: Record<string, string | string[] | undefined>;
  requestId?: string;
}
export interface HttpResponse {
  statusCode: number;
  headersSent: boolean;
  setHeader(name: string, value: string): void;
  on(event: 'finish', cb: () => void): void;
  status(code: number): HttpResponse;
  json(body: unknown): void;
}

const httpLogger = new Logger('HTTP');

/**
 * Tags every request with an id (reusing an incoming x-request-id if present),
 * echoes it back as a header, and logs one line per request with status and duration.
 */
export function requestLogger(req: HttpRequest, res: HttpResponse, next: () => void) {
  const incoming = req.headers['x-request-id'];
  const id = (typeof incoming === 'string' && incoming.slice(0, 64)) || randomUUID().slice(0, 8);
  req.requestId = id;
  res.setHeader('x-request-id', id);

  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const line = `${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms [${id}]`;
    if (res.statusCode >= 500) httpLogger.error(line);
    else if (res.statusCode >= 400) httpLogger.warn(line);
    else httpLogger.log(line);
  });
  next();
}

const DEFAULT_CODE: Partial<Record<number, string>> = {
  400: 'bad_request',
  404: 'not_found',
  405: 'method_not_allowed',
  429: 'too_many_requests',
  503: 'service_unavailable',
};

/**
 * Turns every thrown error into the standard ErrorBody.
 * - AppException / HttpException: their message is meant for users, pass it through.
 * - Anything else is a bug: log the full stack, but only send a generic message
 *   (plus the request id) so internals never leak to the browser.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<HttpRequest>();
    const res = ctx.getResponse<HttpResponse>();
    const body = toErrorBody(exception, req);

    // The request logger already writes one status line per request; this adds the "why".
    const where = `${req.method} ${req.originalUrl} [${body.requestId ?? '-'}]`;
    if (!(exception instanceof HttpException)) {
      // Unexpected: a bug. Full stack, every time.
      this.logger.error(`${where} → 500 unhandled ${describe(exception)}`, exception instanceof Error ? exception.stack : undefined);
    } else if (body.statusCode >= 500) {
      // Known failure mode (e.g. broken export): its stack was logged when it first happened.
      this.logger.error(`${where} → ${body.statusCode} ${body.code}: ${describe(exception.cause ?? exception)}`);
    } else {
      this.logger.debug(`${where} → ${body.statusCode} ${body.code}: ${body.message}`);
    }

    if (res.headersSent) return;
    res.status(body.statusCode).json(body);
  }
}

export function toErrorBody(exception: unknown, req?: Pick<HttpRequest, 'originalUrl' | 'requestId'>): ErrorBody {
  const base = { requestId: req?.requestId, path: req?.originalUrl, timestamp: new Date().toISOString() };

  if (exception instanceof AppException) {
    return { ...base, statusCode: exception.getStatus(), code: exception.code, message: exception.message, hint: exception.hint };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const r = exception.getResponse();
    const raw = typeof r === 'string' ? r : (r as { message?: unknown }).message;
    const message = Array.isArray(raw) ? raw.join('; ') : typeof raw === 'string' ? raw : exception.message;
    return { ...base, statusCode: status, code: DEFAULT_CODE[status] ?? `http_${status}`, message };
  }
  return {
    ...base,
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'internal_error',
    message: 'Something went wrong on the server while preparing this data.',
    hint: 'Try again. If it keeps happening, share the reference ID with the team.',
  };
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    const cause = err.cause instanceof Error ? ` (caused by ${err.cause.name}: ${err.cause.message})` : '';
    return `${err.name}: ${err.message}${cause}`;
  }
  return String(err);
}
