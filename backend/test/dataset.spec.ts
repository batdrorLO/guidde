import fs from 'node:fs';
import path from 'node:path';
import { buildDataset, companyKey } from '../src/data/build-dataset';
import { resolveDataDir } from '../src/data/dataset.service';
import { parseRaw } from '../src/data/parse';
import { scoreAccount } from '../src/health/health-scoring';

const read = (f: string) => JSON.parse(fs.readFileSync(path.join(resolveDataDir(), f), 'utf8'));

describe('parseRaw', () => {
  it('drops invalid rows and duplicate event ids, and reports both', () => {
    const good = {
      event_id: 'e1',
      workspace_id: 'ws',
      company_name: 'Acme',
      event_type: 'login',
      user_id: 'u',
      timestamp: '2026-09-01T00:00:00Z',
      plan_tier: 'Pro',
    };
    const { events, issues } = parseRaw([], [good, good, { ...good, event_id: 'e2', event_type: 'nope' }]);
    expect(events).toHaveLength(1);
    expect(issues.map((i) => i.code).sort()).toEqual(['duplicate_events', 'invalid_event_rows']);
  });

  it('joins company names case-, spacing- and ampersand-insensitively', () => {
    expect(companyKey('Marlowe & Reed')).toBe(companyKey('marlowe  and reed'));
  });
});

describe('the real export', () => {
  const { accounts, events, issues } = parseRaw(read('accounts.json'), read('usage_events.json'));
  const ds = buildDataset(accounts, events, issues);
  const ctx = { asOf: ds.asOf, windowStart: ds.windowStart, gapDays: ds.gapDays };
  const scored = new Map(ds.records.map((r) => [r.slug, scoreAccount(r, ctx)]));

  it('loads every account and event, and every event finds its account', () => {
    expect(ds.records).toHaveLength(25);
    expect(ds.records.reduce((s, r) => s + r.events.length, 0)).toBe(480);
    expect(ds.issues.some((i) => i.code === 'event_without_account')).toBe(false);
  });

  it('detects the 2026-06-28 ingestion gap', () => {
    expect(ds.gapDays).toEqual(['2026-06-28']);
  });

  it('rolls up the three multi-workspace accounts', () => {
    const multi = ds.issues.filter((i) => i.code === 'multi_workspace').map((i) => i.companyName).sort();
    expect(multi).toEqual(['Alderman Freight', 'Brightside Logistics', 'Cobalt Financial']);
  });

  it('flags the Enterprise → Pro tier drift as a downgrade', () => {
    for (const slug of ['marlowe-and-reed', 'thistle-and-vine-events']) {
      const h = scored.get(slug)!;
      expect(h.flags.map((f) => f.code)).toContain('downgrade');
      expect(h.tier).not.toBe('healthy');
    }
  });

  it('puts accounts silent for a month or more in At Risk', () => {
    for (const slug of ['redwood-studios', 'tidewater-retail', 'cedarline-insurance']) {
      expect(scored.get(slug)!.tier).toBe('at_risk');
    }
  });
});
