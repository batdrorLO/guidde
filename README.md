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

Open **http://localhost:5173** and sign in. Demo users live in `config/users.json`:

| Email | Password | Role | Can sign in? |
|---|---|---|---|
| `cs.demo@example.com` | `cs-demo-password` | `cs` | Yes |
| `admin.demo@example.com` | `admin-demo-password` | `admin` | Yes |
| `sales.demo@example.com` | `sales-demo-password` | `sales` | No: shows how non-CS users are refused |

Before deploying, replace these users and set a real `JWT_SECRET`. Copy `.env.example` to `.env` for local settings; `.env` is git-ignored.

| Command | What it does |
|---|---|
| `npm test` | Jest tests: scoring unit tests, plus checks against the real export |
| `npm run build` | Production build of both apps |
| `npm run typecheck` | Type-check both apps |

The data lives in `data/` (`accounts.json`, `usage_events.json`). To point the API somewhere else, set `DATA_DIR`.

### Run with Docker (optional)

If you'd rather not install Node, you can run the whole app with Docker. It requires Docker with Compose v2 (Docker Desktop includes both).

```bash
docker compose up --build    # first run builds the images (a minute or two)
```

Open **http://localhost:8080** and sign in with the demo users above. To stop, press `Ctrl+C`, or run `docker compose down` if you started it with `-d`.

There are two containers:

- **`web`**: nginx serves the built UI and forwards `/api` to the API. The browser sees a single origin, so the session cookie works with no CORS setup.
- **`api`**: the NestJS API, running the compiled build.

`data/` and `config/` are mounted read-only rather than copied into the image. If you edit the export or the users file on your machine, the API picks up the change without a rebuild.

Compose reads settings from `.env` in the repo root, if it exists. The ones that matter here:

| Variable | Default in Docker | Notes |
|---|---|---|
| `JWT_SECRET` | empty | Empty means a random secret per run, so everyone is signed out when the container restarts. Set one to keep sessions across restarts. |
| `WEB_PORT` | `8080` | Change it if 8080 is already in use, e.g. `WEB_PORT=3000 docker compose up`. |
| `COOKIE_SECURE` | `false` | The app runs on plain http on localhost. Set it to `true` when serving over HTTPS. |

API logs: `docker compose logs -f api`.

**About `npm audit`.** `npm audit --omit=dev` reports **0 vulnerabilities** in the code the app runs. The ~40 that `npm install` reports are all in local build and test tooling: Tailwind 3, Nest CLI 11, and Jest's coverage plugin. They're denial-of-service style issues that need attacker-controlled input, and these tools only ever read this repo's own files. Clearing them would mean migrating to Tailwind 4 and Nest CLI 12 and replacing Jest with Vitest. That's out of scope for this exercise, and I list it under next steps below. Don't run `npm audit fix --force`: it forces those major upgrades blindly.

### API

| Endpoint | Returns |
|---|---|
| `GET /api/accounts?days=&minTenure=&status=&plan=&csm=&q=&sort=&order=` | Scored accounts for the given settings (`days` 7–180, default 30; `minTenure` 0–730, default 30). `status` is `healthy`, `watch`, `at_risk`, `onboarding` or `insufficient_data`; `tier` is still accepted as an alias. `sort` is one of `priority` (default), `score`, `arr`, `name`, `lastActivity`. Invalid values return 400. |
| `GET /api/accounts/:slug?days=&minTenure=` | One account in full: score, score tier, status, overrides with reasons, the window used, activity against its plan, the pillars with explanations, flags, weekly activity, and per-user, per-workspace and recent-event lists |
| `GET /api/summary?days=&minTenure=` | Count and ARR per status, the settings and window actually applied, the reference date, and the list of CSMs |
| `GET /api/data-quality` | Every data issue found in the export and how it was handled |
| `GET /api/methodology` | The live scoring config (presets, limits, plan expectations, thresholds). The settings bar and the methodology page both render from it. |
| `GET /api/status` | **Public.** Always returns 200 while the API is running. `status` is `ok`, or `degraded` if the export couldn't be loaded (the reason is shown only to signed-in users). |
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` | Authentication; see below. Every other endpoint needs a signed-in CS user and returns `401` or `403` otherwise. |

### Authentication

Only the Customer Success team can use the dashboard. Every API route requires a valid JWT unless it's explicitly marked `@Public()`; only sign-in, sign-out and `/api/status` are. The guard is registered globally, so a new endpoint can't ship without auth by accident.

**Signing in**
- **Endpoint.** `POST /api/auth/login` checks the email and password against `config/users.json`, which stores bcrypt hashes.
- **Who gets in.** Only users whose role is in `AUTH_ALLOWED_ROLES` (default `cs,admin`) are let in. Anyone else gets a 403, even with the correct password.
- **The token.** The API issues a JWT signed with HS256 that expires after `JWT_TTL_HOURS` (default 8). The browser receives it in an **httpOnly, SameSite=Strict** cookie. JavaScript can't read the cookie, so an XSS bug can't steal it, and SameSite blocks cross-site request forgery. The cookie is also marked `Secure` in production.
- **API clients.** The same token is returned in the response body. Scripts can send it as `Authorization: Bearer <token>`.
- **Signing out and checking the session.** `POST /api/auth/logout` clears the cookie. `GET /api/auth/me` returns the current user.

**Protections**
- **Algorithm pinning.** The algorithm, issuer and audience are fixed, so tampered tokens, tokens signed with another secret, and `alg: none` tokens are all rejected.
- **Access changes apply immediately.** Every request checks the user file, not just the token. Removing someone or changing their role takes effect on their next request, not when their token expires. The file is reloaded automatically when it changes.
- **No account enumeration.** A wrong password and an unknown email get the same response, which takes the same time to arrive.
- **Lockout.** After 5 failed attempts, sign-in is paused for 15 minutes per IP and email. Behind a load balancer, set `TRUST_PROXY`.
- **No caching.** API responses send `Cache-Control: no-store`, so account data can't be read from the browser cache after sign-out.
- **Secret checks.** If `JWT_SECRET` is missing or shorter than 32 characters, the API refuses to start in production. In development, it falls back to a random secret for that run and logs a warning.

**In the UI**
- Opening any URL while signed out shows the sign-in form. After signing in, you continue to the page you opened.
- If a session expires or access is revoked mid-use, you're taken back to the sign-in screen with the reason.
- The header shows who is signed in, with a **Sign out** button.

**Logs.** Every sign-in, failed attempt (with the reason), refusal and lockout is logged. Each request line includes the signed-in user's email.

**Managing users**

```bash
npm run user -w backend -- list
npm run user -w backend -- add jane@company.com "Jane Doe" cs   # prompts for the password (12+ chars)
npm run user -w backend -- remove jane@company.com              # their sessions stop working immediately
```

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

> **A healthy account is one where people keep coming back, keep making and watching guides, the people who adopted it are still around, and usage isn't fading, measured against what its plan should be doing.**

> ⚠️ **Every target and threshold below is an initial business assumption, not a validated churn predictor.** They come from the product brief and a 25-account sample. Before anyone relies on them, they must be calibrated against real renewal, downgrade and churn outcomes.

All scoring happens in one place: pure functions in [`backend/src/health/health-scoring.ts`](backend/src/health/health-scoring.ts), with every number in [`scoring.config.ts`](backend/src/health/scoring.config.ts). The UI only sends the CSM's settings and displays what the API returns, so the frontend and backend can't disagree about a score.

### Settings a CSM controls

These appear in the bar under the header, on every page. They're stored in the URL (`?days=&minTenure=`), like the list filters, so they survive a refresh and a shared link reproduces the exact view. Defaults are left out of the URL.

| Setting | Default | Allowed values | Effect |
|---|---|---|---|
| **Analysis period** (`days`) | 30 | Presets 7 / 14 / 30 / 60 / 90, or any whole number from 7 to 180 | Recalculates all four pillars, the score, the status, the priority, the summary tiles, the queue, the account page explanations and the chart marker |
| **Minimum tenure** (`minTenure`) | 30 | Whole number from 0 to 730 | Accounts younger than this aren't scored (see below) |

Invalid values, typed into the bar or put directly in the URL, are rejected with a readable message. The API returns `400 invalid_setting`.

### Reference date and windows

- **"Now" is the latest event in the export** (2026-09-13 for this file), never today's date. Opening the dashboard next year gives the same results.
- **Current window:** the *N* calendar days (UTC) ending on the reference day, **with both ends included**. At 30 days, that's 2026-08-15 to 2026-09-13.
- **Baseline window**, used for momentum: the *2N* calendar days immediately before the current window (at 30 days, 2026-06-16 to 2026-08-14). The two never overlap.
- **Observable days:** a day only counts if the export can actually show it. Two kinds of day are left out: days before the export starts, and ingestion gaps. An ingestion gap is a day with zero events from *any* account; there's one, 2026-06-28. Neither is ever counted as an inactive day, and gap days are reported as missing data (in the window details, an account flag, and the activity charts).
- **Limitation:** the export has no explicit coverage metadata, so a gap can only be detected when *every* account is silent. If ingestion failed for one workspace only, that can't be distinguished from real inactivity.

### Minimum tenure

Tenure is the number of whole days from `contract_start_date` (in `accounts.json`, the contract of record) to the reference day. Activity events are never used to guess it.

- **Tenure below the minimum → Onboarding.** The account gets no score, no tier and no priority, and it's left out of the Healthy / Watch / At Risk counts and the risk queue. It's listed last, showing its tenure and the reason. A new account is never labelled Healthy or At Risk just for being new.
- **Unusable start date → Not enough data**, for example an impossible date like 2025-02-30. The account is not assumed to have met the minimum.
- Every account in this export is over 120 days old, so with the default of 30 all of them are scored. Set the minimum to 180 and four accounts become Onboarding.

The separate **Onboarding** context flag (contract under 180 days old) is still shown on accounts that *are* scored. It never affects the score.

### The four pillars (0–100)

| Pillar | Max | Formula |
|---|---|---|
| **Activity** | 30 | `rate = activeDays ÷ observableDays`, where an active day is any day with an event of any type. Points = `30 × min(rate ÷ planFullCreditRate, 1)` |
| **Value loop** | 30 | Two halves, worth 15 points each. **Produce:** `guide_created + guide_shared`. **Consume:** `guide_viewed`. Each half = `15 × min(count ÷ windowTarget, 1)`, where `windowTarget = targetPer30Days × N ÷ 30`. Logins and invites never count. |
| **User retention** | 20 | `rate = usersActiveInWindow ÷ uniqueUsersInWholeExport`. Points = `20 × min(rate ÷ 0.60, 1)`. If the account has no users at all, it gets 0 points, never full retention. |
| **Momentum** | 20 | Compares events per observable day in the current window with the baseline window, with +1 smoothing on both counts. A ratio of ≥ 1.0 earns full credit, ≤ 0.4 (a drop of 60% or more) earns 0, and the points scale linearly in between. No events in the current window → 0. **Insufficient baseline:** if less than 50% of the baseline is observable, momentum can't be measured fairly and gets a **neutral 10/20**, which neither invents growth nor invents decline. This happens for periods longer than about 44 days, because the export only goes back 89 days. The account page explains it when it happens. |

### Plan expectations

| Plan | Full Activity credit | **At Risk below** | Produce target / 30 days | Consume target / 30 days |
|---|---|---|---|---|
| Free | 20% | **15%** | 2 | 2 |
| Pro | 40% | **25%** | 3 | 4 |
| Enterprise | 60% | **40%** | 4 | 5 |

For example, take an account active on 10 of 30 observable days, which is 33.3%. On Free that earns full Activity credit and doesn't trigger the activity rule. On Enterprise it's **At Risk**, even if every other pillar is perfect and its numeric score is 87.

### Rule precedence

1. Resolve the plan, reference date, tenure and observable days.
2. If the account is below minimum tenure → **Onboarding**. If its tenure is unknown, its plan is unknown, or no day is observable → **Not enough data**. In both cases, stop here: no score.
3. Compute the four pillars.
4. **Plan downgrade** (the latest events show a lower plan than the contract): −20 points, with the score clamped to 0–100.
5. **Score tier** from that score: Healthy ≥ 70 · Watch 45–69 · At Risk < 45.
6. **Hard rules.** Every rule that applies is reported, and the numeric score is never changed to force a status:
   - **Dormant**: no events for more than 21 days before the reference date → **At Risk**. Days missing from the export don't count toward the 21. This rule is separate from a low activity rate.
   - **Activity below the plan's At Risk threshold** → **At Risk**.
   - **Downgrade** → the account **can't be Healthy**. If its score would make it Healthy, it becomes Watch.

The API keeps the three concepts separate:
- `score`: the number.
- `scoreTier`: what the number alone gives.
- `status`: the final, effective status.

When `status` differs from `scoreTier`, `statusReason` explains why. The account page shows "Score alone: Healthy → At Risk by rule", followed by every reason that applied.

**Context flags** (Onboarding under 180 days, Low signal under 8 events, Multiple workspaces) are informational only and never change the score.

### Priority (the work queue)

`priority = (100 − score) × log10(ARR + 10)`, using the score *after* the downgrade penalty. ARR is never part of the health score. The default sort groups accounts by **effective status**: At Risk first, then Watch, then Healthy. Within each group it ranks by priority. That way an account a rule forced into At Risk sits with the other At Risk accounts instead of below Watch accounts. Onboarding and Not-enough-data accounts have no priority and come last.

### What this gives on the real export

At the defaults (30 days, minimum tenure 30): **15 At Risk, 0 Watch, 10 Healthy**.

The plan-specific activity rule drives most of that. Activity in this sample is sparse: most accounts are active on 10–40% of days. So several Pro and Enterprise accounts with high numeric scores land in At Risk, for example:
- Crestwood Staffing: score 85, activity 36.7% against Enterprise's 40% threshold.
- Ashgrove Legal: score 84, activity 23.3% against Pro's 25% threshold.

That is the specified behaviour. It's also the strongest reason to calibrate these thresholds on real outcome data before use.

At 7 days the result is 18 / 1 / 6, and at 90 days it's 17 / 0 / 8.

## Data findings and assumptions

| What I found | What I did |
|---|---|
| **Some accounts have more than one workspace.** Alderman Freight, Brightside Logistics and Cobalt Financial each have 2. | Rolled up into one account for scoring. The drill-down shows the per-workspace breakdown. |
| **The plan tier on events disagrees with `accounts.json`.** Marlowe & Reed (since 2026-09-01) and Thistle & Vine (since 2026-08-31) appear as Pro on events, but as Enterprise in the accounts file. | `accounts.json` is treated as the contract of record, used for ARR and targets. A move to a lower tier on events is scored as a downgrade risk, and the CSM is told to confirm it. It might just be stale CRM data. |
| **A day with no events at all.** No account has any events on 2026-06-28. | Treated as **missing data** (an ingestion gap), not as 25 customers all going quiet on the same day. The day isn't counted as an observable day for Activity or Momentum, and it doesn't count toward the 21-day dormancy rule, so nobody is marked inactive for it. Every account whose period or momentum comparison includes that day gets an informational "Missing data" flag (no score effect). Weekly activity charts mark that week with an asterisk, so its shorter bar isn't read as a drop in usage. It's also listed on the methodology page. |
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
  data/dataset.service.ts   loads data/; on failure stays up, serves 503s, retries on next request
  health/scoring.config.ts  every weight, target and threshold
  health/health-scoring.ts  pure scoring functions with plain-English explanations
  health/health.service.ts  scores on first use (per-account failures isolated); filter, sort, detail, summary
  auth/                     JWT auth: config, users file store, login/logout/me, global guard + @Public()
  accounts/, meta/          controllers (meta includes /api/status)
  common/errors.ts          AppException, DataLoadError, DataUnavailableException
  common/http.ts            request logging middleware + global exception filter
backend/scripts/user.mjs    add / remove / list dashboard users
config/users.json           users who may sign in (bcrypt hashes, roles)
backend/test/               Jest unit tests, tests against the real export, auth tests over HTTP
frontend/src/
  auth/AuthContext.tsx      session state; drops to sign-in on any 401
  pages/                    AccountsPage, AccountDetailPage, MethodologyPage, LoginPage
  components/               table, filters, summary tiles, pillar bars, activity chart, flags,
                            ErrorBox (message, hint, ref, retry), ErrorBoundary
  api/                      typed client (ApiError, timeouts, retry) and DTO types (mirrors backend/src/common/types.ts)
docker-compose.yml          api + web containers; mounts data/ and config/
backend/Dockerfile          multi-stage build → compiled API on node:24-alpine
frontend/Dockerfile         multi-stage build → static UI on nginx
frontend/nginx.conf         serves the SPA, proxies /api to the api container
```

The scoring code is a set of pure functions with no Nest dependency. That makes it easy to unit-test, and easy to move into a batch job later.

## A note on the stack

The brief suggests Next.js. I used a separate NestJS API and a React SPA instead. The API is a real service boundary, so other consumers could call it, such as Salesforce sync, Slack alerts or a warehouse job. It also keeps the scoring logic independent of the UI framework. The trade-off is two processes in development; `npm run dev` runs both together.

## What I'd build next for production

1. **Real data pipeline.** Read events from the warehouse (dbt model) on a schedule and store a daily health snapshot per account. That gives score history and "changed tier this week" alerts. Today everything is computed in memory from a static file.
2. **Validate the model.** Back-test against real renewal, churn and downgrade outcomes, then fit the weights and targets to that data instead of to this snapshot's distribution. Track the model's precision on churned accounts.
3. **Better identity.** Join on a stable account ID from the CRM instead of company name, and sync the CSM owner, ARR and plan from Salesforce so tier drift can't happen silently.
4. **Act on the scores.** Send Slack or email alerts when an account drops a tier, and add CSM notes and "acknowledged" state on each account.
5. **Platform work.** Replace the users file with SSO (Google Workspace or Okta via OIDC), taking roles from the identity provider's groups. Add per-CSM views ("my accounts"). Add server-side session revocation (a token deny-list) or short-lived access tokens with refresh tokens. Use a shared rate-limit store (Redis) once there's more than one API instance. A shared `@app/types` package (or an OpenAPI-generated client) instead of the mirrored DTO file. Request validation with DTO classes. Frontend tests (Playwright). CI. Docker. Upgrade the dev tooling (Tailwind 4, Nest CLI 12, Jest → Vitest) so `npm audit` is clean for dev dependencies too.

## How AI assistance was used

_To be completed by the author: what was accepted from the assistant, and what was rewritten or double-checked._

Example of a catch made during development: the momentum pillar originally gave full credit to an account with **zero** events, because the +1 smoothing turned 0-vs-0 into a "growth" ratio of 2. A unit test caught it, and the fix is in `health-scoring.ts`.
