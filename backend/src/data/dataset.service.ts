import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { DataLoadError, DataUnavailableException } from '../common/errors';
import type { Dataset } from '../common/types';
import { buildDataset } from './build-dataset';
import { parseRaw } from './parse';

export interface DataStatus {
  loaded: boolean;
  asOf?: string;
  accounts?: number;
  events?: number;
  error?: { code: string; message: string; hint?: string };
}

/**
 * Loads the export from disk. The data is a static snapshot; in production
 * this would read from the warehouse on a schedule instead.
 *
 * A broken export must not take the API down: if loading fails, the service
 * stays up, every data endpoint answers 503 with a readable explanation, and
 * the next request after `retryIntervalMs` tries again — so fixing the file
 * and refreshing the page recovers without a restart.
 */
@Injectable()
export class DatasetService implements OnModuleInit {
  private readonly logger = new Logger(DatasetService.name);
  private dataset: Dataset | null = null;
  private lastError: DataLoadError | null = null;
  private lastAttempt = 0;
  /** Minimum gap between reload attempts while the data is broken. */
  retryIntervalMs = 5_000;

  onModuleInit() {
    this.load();
  }

  /** The loaded dataset, or a 503 DataUnavailableException explaining why there isn't one. */
  get(): Dataset {
    if (!this.dataset && Date.now() - this.lastAttempt >= this.retryIntervalMs) this.load();
    if (!this.dataset) throw new DataUnavailableException(this.lastError ?? unknownLoadError());
    return this.dataset;
  }

  status(): DataStatus {
    try {
      const ds = this.get();
      const events = ds.records.reduce((n, r) => n + r.events.length, 0);
      return { loaded: true, asOf: ds.asOf.toISOString(), accounts: ds.records.length, events };
    } catch {
      const e = this.lastError ?? unknownLoadError();
      return { loaded: false, error: { code: e.code, message: e.message, hint: e.hint } };
    }
  }

  private load() {
    this.lastAttempt = Date.now();
    const started = Date.now();
    try {
      const dir = resolveDataDir();
      this.logger.log(`Loading export from ${dir}`);
      const parsed = parseRaw(readJsonFile(dir, 'accounts.json'), readJsonFile(dir, 'usage_events.json'));

      for (const r of parsed.rejected) {
        this.logger.warn(`Rejected ${r.file} row #${r.index}: ${r.reason}`);
      }
      if (parsed.accounts.length === 0) {
        throw new DataLoadError(
          'no_valid_accounts',
          'The accounts file has no usable accounts, so there is nothing to score.',
          'Every row in accounts.json needs company_name, domain, plan_tier, contract_start_date, arr_usd and csm_owner. See the server log for the rejected rows.',
        );
      }
      if (parsed.events.length === 0) {
        throw new DataLoadError(
          'no_valid_events',
          'The usage events file has no usable events, so health cannot be computed.',
          'Every event needs event_id, workspace_id, company_name, a known event_type, user_id, an ISO timestamp and plan_tier. See the server log for the rejected rows.',
        );
      }

      const ds = buildDataset(parsed.accounts, parsed.events, parsed.issues);
      if (this.lastError) this.logger.log(`Recovered from earlier data error [${this.lastError.code}]`);
      this.dataset = ds;
      this.lastError = null;

      this.logger.log(
        `Loaded ${parsed.accounts.length} accounts and ${parsed.events.length} events ` +
          `(as of ${ds.asOf.toISOString()}) in ${Date.now() - started}ms`,
      );
      for (const issue of ds.issues) {
        const line = `Data quality [${issue.code}] ${issue.message}`;
        if (issue.severity === 'info') this.logger.debug(line);
        else this.logger.warn(line);
      }
    } catch (err) {
      const e =
        err instanceof DataLoadError
          ? err
          : new DataLoadError(
              'data_load_failed',
              'The usage data could not be processed.',
              'This looks like a bug in the data pipeline. Check the server log for details.',
              { cause: err },
            );
      this.lastError = e;
      const cause = e.cause instanceof Error ? ` (${e.cause.message})` : '';
      this.logger.error(
        `Data load failed [${e.code}]: ${e.message}${cause}`,
        e.cause instanceof Error ? e.cause.stack : undefined,
      );
    }
  }
}

function unknownLoadError() {
  return new DataLoadError('data_not_loaded', 'Account data has not been loaded yet.', 'Try again in a few seconds.');
}

function readJsonFile(dir: string, file: string): unknown {
  const full = path.join(dir, file);
  let text: string;
  try {
    text = fs.readFileSync(full, 'utf8');
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
    throw new DataLoadError(
      missing ? 'data_file_missing' : 'data_file_unreadable',
      missing
        ? `The data file "${file}" is missing, so account health can't be computed.`
        : `The data file "${file}" couldn't be read.`,
      missing ? `Put ${file} in ${dir} and refresh.` : `Check the file permissions on ${full}.`,
      { cause: err },
    );
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new DataLoadError(
      'data_file_invalid_json',
      `The data file "${file}" isn't valid JSON. It may be truncated or edited by hand.`,
      `Re-export ${file}, or fix this error: ${(err as Error).message}`,
      { cause: err },
    );
  }
}

/** DATA_DIR env var, else the nearest `data/` folder above this file (works from src/ and dist/). */
export function resolveDataDir(): string {
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
  let dir = __dirname;
  for (;;) {
    const candidate = path.join(dir, 'data', 'accounts.json');
    if (fs.existsSync(candidate)) return path.dirname(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new DataLoadError(
        'data_dir_not_found',
        "The data folder couldn't be found, so there is nothing to score.",
        'Put accounts.json and usage_events.json in the project-level data/ folder, or set the DATA_DIR environment variable.',
      );
    }
    dir = parent;
  }
}
