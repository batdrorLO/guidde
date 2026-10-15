import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HttpStatus, Logger, NotFoundException } from '@nestjs/common';
import { AppException, DataLoadError, DataUnavailableException } from '../src/common/errors';
import { toErrorBody } from '../src/common/http';
import { DatasetService, resolveDataDir } from '../src/data/dataset.service';
import { parseRaw } from '../src/data/parse';
import { HealthService } from '../src/health/health.service';

// Error paths log loudly by design; keep test output readable.
beforeAll(() => Logger.overrideLogger(false));

const realData = resolveDataDir();
const copyReal = (dir: string, file: string) => fs.copyFileSync(path.join(realData, file), path.join(dir, file));

function serviceFor(dir: string) {
  process.env.DATA_DIR = dir;
  const svc = new DatasetService();
  svc.retryIntervalMs = 0;
  svc.onModuleInit();
  return svc;
}

function expectUnavailable(svc: DatasetService, code: string) {
  try {
    svc.get();
    throw new Error('expected get() to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(DataUnavailableException);
    const e = err as DataUnavailableException;
    expect(e.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(e.code).toBe(code);
    expect(e.message.length).toBeGreaterThan(10);
    expect(e.hint).toBeTruthy();
  }
}

describe('DatasetService error handling', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ahd-'));
  });
  afterEach(() => {
    delete process.env.DATA_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('does not crash on startup when a file is missing, and explains it on use', () => {
    copyReal(dir, 'accounts.json');
    const svc = serviceFor(dir);
    expectUnavailable(svc, 'data_file_missing');
    expect(svc.status()).toMatchObject({ loaded: false, error: { code: 'data_file_missing' } });
  });

  it('reports invalid JSON with the parser message in the hint', () => {
    copyReal(dir, 'accounts.json');
    fs.writeFileSync(path.join(dir, 'usage_events.json'), '[{"event_id": ');
    const svc = serviceFor(dir);
    expectUnavailable(svc, 'data_file_invalid_json');
  });

  it('reports a file that is not a list', () => {
    copyReal(dir, 'usage_events.json');
    fs.writeFileSync(path.join(dir, 'accounts.json'), '{"accounts": []}');
    expectUnavailable(serviceFor(dir), 'data_file_wrong_shape');
  });

  it('reports a file with no valid rows', () => {
    copyReal(dir, 'accounts.json');
    fs.writeFileSync(path.join(dir, 'usage_events.json'), JSON.stringify([{ event_id: 'x' }]));
    expectUnavailable(serviceFor(dir), 'no_valid_events');
  });

  it('recovers on the next request once the file is fixed, without a restart', () => {
    copyReal(dir, 'accounts.json');
    const svc = serviceFor(dir);
    expectUnavailable(svc, 'data_file_missing');
    copyReal(dir, 'usage_events.json');
    expect(svc.get().records.length).toBeGreaterThan(0);
    expect(svc.status().loaded).toBe(true);
  });

  it('surfaces data errors through HealthService instead of failing at startup', () => {
    const health = new HealthService(serviceFor(dir));
    expect(() => health.summary()).toThrow(DataUnavailableException);
  });
});

describe('parseRaw', () => {
  it('records why rows were rejected', () => {
    const { rejected } = parseRaw([{ company_name: '' }], []);
    expect(rejected[0]).toMatchObject({ file: 'accounts.json', index: 0 });
    expect(rejected[0].reason).toContain('company_name');
  });

  it('throws a DataLoadError for non-array input', () => {
    expect(() => parseRaw({}, [])).toThrow(DataLoadError);
  });
});

describe('toErrorBody', () => {
  const req = { originalUrl: '/api/x', requestId: 'abc123' };

  it('passes AppException details through', () => {
    const body = toErrorBody(new AppException(HttpStatus.NOT_FOUND, 'account_not_found', 'No such account.', 'Go back.'), req);
    expect(body).toMatchObject({ statusCode: 404, code: 'account_not_found', message: 'No such account.', hint: 'Go back.', requestId: 'abc123' });
  });

  it('maps built-in HttpExceptions to a stable code', () => {
    expect(toErrorBody(new NotFoundException('Cannot GET /api/nope'), req)).toMatchObject({ statusCode: 404, code: 'not_found' });
  });

  it('hides internals of unexpected errors', () => {
    const body = toErrorBody(new TypeError("Cannot read properties of undefined (reading 'secret')"), req);
    expect(body.statusCode).toBe(500);
    expect(body.code).toBe('internal_error');
    expect(body.message).not.toContain('secret');
    expect(body.requestId).toBe('abc123');
  });
});
