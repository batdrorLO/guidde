import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Every error the API returns has this shape, so the UI can always show
 * a readable message, a next step (`hint`) and a reference to find it in the logs.
 */
export interface ErrorBody {
  statusCode: number;
  /** Stable machine-readable code, e.g. "data_file_missing". */
  code: string;
  /** Plain-English, safe to show to a CSM. */
  message: string;
  /** What the user / operator can do about it. */
  hint?: string;
  /** Matches the x-request-id header and the server log line. */
  requestId?: string;
  path?: string;
  timestamp: string;
}

/** An HTTP error with a user-facing message, a stable code and an optional hint. */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
    readonly hint?: string,
    cause?: unknown,
  ) {
    super({ code, message, hint }, status, { cause });
  }
}

/**
 * The raw export couldn't be turned into a dataset (missing file, bad JSON,
 * nothing valid in it…). Raised by the data layer; not HTTP-aware.
 */
export class DataLoadError extends Error {
  constructor(
    readonly code: string,
    /** User-facing explanation. */
    message: string,
    readonly hint?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'DataLoadError';
  }
}

/** 503: the service is up, but has no usable data to serve. */
export class DataUnavailableException extends AppException {
  constructor(err: DataLoadError) {
    super(HttpStatus.SERVICE_UNAVAILABLE, err.code, err.message, err.hint, err);
  }
}
