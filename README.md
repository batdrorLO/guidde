# Account Health Dashboard

An internal tool for CS and Sales. It shows which customer accounts are healthy and which are at risk, and explains why each account scored the way it did. The input is a 90-day product usage export.

- **Backend:** NestJS + TypeScript. It loads and validates the export, scores every account, and serves a REST API.
- **Frontend:** React + TypeScript (Vite, Tailwind, Recharts). It has three pages: an account list, an account drill-down, and a methodology/data-quality page.

## Setup

Requires Node 20 or later.

```bash
npm install        # installs both workspaces
npm run dev        # API on http://localhost:3001/api, UI on http://localhost:5173
```

Open **http://localhost:5173**.

| Command | What it does |
|---|---|
| `npm test` | Jest tests: scoring unit tests, plus checks against the real export |
| `npm run build` | Production build of both apps |
| `npm run typecheck` | Type-check both apps |

The data lives in `data/` (`accounts.json`, `usage_events.json`). To point the API somewhere else, set `DATA_DIR`.

**About `npm audit`.** `npm audit --omit=dev` reports **0 vulnerabilities** in the code the app runs. The ~40 that `npm install` reports are all in local build and test tooling: Tailwind 3, Nest CLI 11, and Jest's coverage plugin. They're denial-of-service style issues that need attacker-controlled input, and these tools only ever read this repo's own files. Clearing them would mean migrating to Tailwind 4 and Nest CLI 12 and replacing Jest with Vitest. That's out of scope for this exercise, and I list it under next steps below. Don't run `npm audit fix --force`: it forces those major upgrades blindly.

### API

| Endpoint | Returns |
|---|---|
| `GET /api/accounts?tier=&plan=&csm=&q=&sort=&order=` | Scored accounts. `sort` is one of `priority` (default), `score`, `arr`, `name`, `lastActivity`. Invalid values return 400. |
| `GET /api/accounts/:slug` | One account in full: the pillars, flags, weekly activity, and per-user, per-workspace and recent-event lists |
| `GET /api/summary` | Count and ARR per tier, list of CSMs, snapshot date |
| `GET /api/data-quality` | Every data issue found in the export and how it was handled |
| `GET /api/methodology` | The live scoring config, which the methodology page renders |
| `GET /api/status` | Always returns 200 while the API is running. `status` is `ok`, or `degraded` with the reason if the export couldn't be loaded. |

### Errors and logging

**Error format.** Every API error has the same JSON shape:

```json
{ "statusCode": 503, "code": "data_file_invalid_json", "message": "The data file \"usage_events.json\" isn't valid JSON…", "hint": "Re-export usage_events.json, or fix this error: …", "requestId": "4b072824", "path": "/api/summary", "timestamp": "…" }
```

- `message` and `hint` are written for a CSM to read.
- `code` is stable, so other code can rely on it.
- `requestId` matches both the `x-request-id` response header and the server log line, so a reported problem can be traced.
- Unexpected errors (bugs) return a generic message. The stack trace goes to the log only, so internal details never reach the browser.

**A broken export doesn't crash the API.** Possible causes are a missing file, invalid JSON, a file that isn't a list of rows, or a file with no valid rows. In all of these cases:

1. The API still starts.
2. Every data endpoint returns `503` with an explanation of the problem and how to fix it.
3. `/api/status` reports `degraded`.
4. Once the file is fixed, the next request reloads it. There's no need to restart.

Individual invalid rows are dropped, and each one is logged with the reason it was rejected. If a single account fails to score, it's left off the dashboard and reported as a data-quality issue, rather than breaking the whole page.

**In the UI**, every failed request shows:
- what happened,
- what to do next,
- a reference ID, and
- a **Try again** button.

Some failures get their own message: the API being unreachable or timing out (15 seconds), the data being unavailable, and an unknown account. Rendering crashes are caught by an error boundary, so one bad page can't blank the app. Failures are also logged to the browser console with an `[api]` or `[ui]` prefix.

**Logs.** The API writes:
- one line per request: method, path, status, duration and request ID;
- the data-load summary;
- each data-quality issue;
- each rejected row;
- the reason behind every error.

To configure the logs:
- `LOG_LEVEL` sets the detail: `error`, `warn`, `info` (default), `debug` or `verbose`.
- `LOG_FORMAT=json` writes one JSON object per line, for log shippers.

## What "account health" means

> **A healthy account is one where people keep coming back, keep making and watching guides, the people who adopted it are still around, and usage isn't fading.**

Each score is 0–100. It is computed over the **last 30 days** and compared against **targets that scale with the plan**, so a $200k Enterprise contract is held to a higher bar than a free team. "Now" is the latest event in the export (2026-09-13), not today's date.

| Pillar | Pts | What it measures | Why |
|---|---|---|---|
| **Activity** | 30 | Distinct days with any activity. Targets: Free 3, Pro 6, Enterprise 8. | Rewards consistency over volume, so one busy afternoon can't hide three silent weeks. The strongest leading indicator of churn is people stopping showing up. |
| **Value loop** | 30 | Half of the points come from guides created or shared. The other half come from guides viewed. Targets scale per plan. | Guidde's value is the create → share → view loop. Content nobody watches is failing, and so is an audience with no new content. Logins and invites don't count here: logging in isn't the same as getting value. |
| **User retention** | 20 | Users active in the last 30 days ÷ all users seen in the 90-day export. 60% or more earns full credit. | Catches the account whose champion is still active while everyone else has drifted away. It's a ratio, so it's fair to both small and large teams. |
| **Momentum** | 20 | Events per day in the last 30 days compared with the account's own prior 60 days. Flat or growing earns full credit; a 60% drop earns none. | Compares each account against its own baseline rather than against other accounts. +1 smoothing stops small accounts from swinging wildly. |

**Overrides**
- **Plan downgrade** (events show a lower plan than the contract): −20 points, and the account can never be Healthy. A downgrade means ARR is either already shrinking or about to.
- **Dormant** (no activity for more than 21 days): always At Risk, whatever the other pillars say.

**Context flags** (shown, but they don't change the score): Onboarding (contract less than 180 days old), Low signal (fewer than 8 events), Multi-workspace.

**Tiers:** Healthy ≥ 70 · Watch 45–69 · At risk < 45.

**Priority** (the default sort order) is `(100 − score) × log10(ARR + 10)`. ARR is deliberately **not** part of the health score, since a $0 Free account can be perfectly healthy. But a CSM's time should go to unhealthy accounts with the most ARR, so the list is ranked that way. The log scale means ARR matters without drowning out health.

All weights, targets and thresholds live in [`backend/src/health/scoring.config.ts`](backend/src/health/scoring.config.ts). On this snapshot the model gives 6 At Risk accounts, 5 Watch and 14 Healthy.

## Data findings and assumptions

| What I found | What I did |
|---|---|
| **Some accounts have more than one workspace.** Alderman Freight, Brightside Logistics and Cobalt Financial each have 2. | Rolled up into one account for scoring. The drill-down shows the per-workspace breakdown. |
| **The plan tier on events disagrees with `accounts.json`.** Marlowe & Reed (since 2026-09-01) and Thistle & Vine (since 2026-08-31) appear as Pro on events, but as Enterprise in the accounts file. | `accounts.json` is treated as the contract of record, used for ARR and targets. A move to a lower tier on events is scored as a downgrade risk, and the CSM is told to confirm it. It might just be stale CRM data. |
| **A day with no events at all.** No account has any events on 2026-06-28. | Treated as an ingestion gap rather than 25 customers all going quiet on the same day. The day is excluded from the per-day rates in Momentum, and listed on the methodology page. |
| **Accounts start at different points in the window.** Some accounts' first event is weeks into the window. | The window starts at the first event in the export. The prior period for Momentum is shared by all accounts. |
| **Very sparse activity.** Accounts have 3–40 events each over 90 days. | Pillars use counts of distinct days, ratios, and smoothed rates. Accounts with fewer than 8 events are flagged "low signal". |
| **New contracts.** Marlowe & Reed, Quarrystone and Brightside, among others, signed less than 6 months ago. | They're scored the same way as everyone else, but flagged "Onboarding" so a low score is read as a ramp-up signal rather than churn. |
| **Free accounts with ARR = 0.** | Scored normally. They only sort lower in the priority view. |
| **Company name is the only join key.** | Names are matched case-, spacing- and `&`/`and`-insensitively. |

The pipeline also defends against problems the current export doesn't have:
- invalid rows (validated with zod, then dropped and reported)
- duplicate `event_id`s (de-duplicated)
- events for companies missing from `accounts.json` (reported)
- accounts with no events (scored as inactive)

The `GET /api/data-quality` endpoint and the Methodology page report anything they find.

## Project layout

```
backend/src/
  data/parse.ts             validate raw rows (zod), de-dupe, collect issues
  data/build-dataset.ts     join on company name, roll up workspaces, detect tier drift and gap days
  data/dataset.service.ts   loads data/ once at startup
  health/scoring.config.ts  every weight, target and threshold
  health/health-scoring.ts  pure scoring functions with plain-English explanations
  health/health.service.ts  scores once at startup; filter, sort, detail, summary
  accounts/, meta/          controllers
backend/test/               Jest unit tests and tests against the real export
frontend/src/
  pages/                    AccountsPage, AccountDetailPage, MethodologyPage
  components/               table, filters, summary tiles, pillar bars, activity chart, flags
  api/                      typed client and DTO types (mirrors backend/src/common/types.ts)
```

The scoring code is a set of pure functions with no Nest dependency. That makes it easy to unit-test, and easy to move into a batch job later.

## A note on the stack

The brief suggests Next.js. I used a separate NestJS API and a React SPA instead. The API is a real service boundary, so other consumers could call it, such as Salesforce sync, Slack alerts or a warehouse job. It also keeps the scoring logic independent of the UI framework. The trade-off is two processes in development; `npm run dev` runs both together.

## What I'd build next for production

1. **Real data pipeline.** Read events from the warehouse (dbt model) on a schedule and store a daily health snapshot per account. That gives score history and "changed tier this week" alerts. Today everything is computed in memory from a static file.
2. **Validate the model.** Back-test against real renewal, churn and downgrade outcomes, then fit the weights and targets to that data instead of to this snapshot's distribution. Track the model's precision on churned accounts.
3. **Better identity.** Join on a stable account ID from the CRM instead of company name, and sync the CSM owner, ARR and plan from Salesforce so tier drift can't happen silently.
4. **Act on the scores.** Send Slack or email alerts when an account drops a tier, and add CSM notes and "acknowledged" state on each account.
5. **Platform work.** SSO/auth and access by CSM. A shared `@app/types` package (or an OpenAPI-generated client) instead of the mirrored DTO file. Request validation with DTO classes. Frontend tests (Playwright). CI. Docker. Upgrade the dev tooling (Tailwind 4, Nest CLI 12, Jest → Vitest) so `npm audit` is clean for dev dependencies too.

## How AI assistance was used

_To be completed by the author: what was accepted from the assistant, and what was rewritten or double-checked._

Example of a catch made during development: the momentum pillar originally gave full credit to an account with **zero** events, because the +1 smoothing turned 0-vs-0 into a "growth" ratio of 2. A unit test caught it, and the fix is in `health-scoring.ts`.
