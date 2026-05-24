# JinAi — Bug Intelligence Platform

An AI-powered browser observability and bug intelligence platform. Install the Chrome extension on any website you're testing — errors are automatically captured, deduplicated, analyzed by AI, clustered, and dispatched to your issue tracker.

---

## How It Works

```
Browser (Chrome Extension)
  └─ captures errors, unhandled rejections, network calls, console logs,
     DOM clicks, SPA navigation, session replay (rrweb), screenshots
      └─ POST /api/v1/ingest/batch  (X-API-Key auth)
          └─ [ingest queue]  →  IngestWorker
              └─ saves events + session to DB
              └─ [error-detection queue]  →  ErrorDetectionWorker
                  └─ fingerprints + deduplicates (DB-level unique constraint)
                  └─ unminifies stack traces via uploaded sourcemaps
                  └─ [ai-analysis queue]  →  AiAnalysisWorker
                      └─ checks Redis cache by fingerprint
                      └─ fetches last 20 session events from DB
                      └─ calls Claude Haiku → structured Bug record
                      └─ [embedding queue]  →  generates vector embedding
                      └─ [clustering queue]  →  ClusteringWorker
                          └─ pgvector KNN → assigns/creates ErrorCluster
                      └─ [rule-evaluation queue]  →  RuleEvaluationWorker
                          └─ evaluates project rules (severity, occurrences, unique users)
                          └─ on match → [dispatch queue]  →  DispatchWorker
                              └─ calls IntegrationProvider (Meridian / Jira / GitHub)
                              └─ retries with backoff [0s, 30s, 5m, 30m, 2h]
                              └─ dead after 5 attempts → DLQ
                          └─ on match → [notification queue]  →  NotificationWorker
                              └─ sends Slack / Email / Teams alerts
```

---

## Project Structure

```
Extension--/
├── backend/                        NestJS API + all workers
│   ├── prisma/
│   │   └── schema.prisma           Full DB schema (all tables)
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/               JWT login/register/verify-email + Google/GitHub OAuth
│   │   │   ├── tenants/            Multi-tenant support
│   │   │   ├── projects/           Project CRUD + API key rotation
│   │   │   ├── environments/       Environment management (dev/staging/prod)
│   │   │   ├── ingest/             POST /ingest/batch → BullMQ → IngestWorker
│   │   │   ├── errors/             ErrorDetectionWorker + stack unminifier
│   │   │   ├── ai-analysis/        AiAnalysisWorker + PromptService + embedding queue
│   │   │   ├── clustering/         ClusteringWorker (pgvector KNN)
│   │   │   ├── rules/              RuleEvaluationWorker + rule-evaluator
│   │   │   ├── integrations/       DispatchWorker + provider registry
│   │   │   │   └── providers/
│   │   │   │       ├── integration.interface.ts    IntegrationProvider interface
│   │   │   │       ├── integration.registry.ts     Provider registry
│   │   │   │       ├── generic-http.provider.ts    ✅ Generic webhook provider
│   │   │   │       ├── github.provider.ts          ✅ GitHub Issues
│   │   │   │       └── meridian-3sc.provider.ts    ✅ Meridian 3SC
│   │   │   ├── notifications/      Slack / Email / Teams alert workers
│   │   │   │   └── providers/
│   │   │   │       ├── slack.provider.ts
│   │   │   │       ├── email.provider.ts
│   │   │   │       └── teams.provider.ts
│   │   │   ├── releases/           Sourcemap upload + stack unminification
│   │   │   ├── upload/             Screenshot upload endpoint
│   │   │   ├── bugs/               GET/PATCH /projects/:id/bugs + AI chat
│   │   │   ├── sessions/           GET /projects/:id/sessions
│   │   │   ├── events/             GET /projects/:id/events
│   │   │   ├── dashboard/          Analytics aggregation service
│   │   │   ├── system/             Queue metrics + pipeline health tracking
│   │   │   ├── retention/          Automated data retention/pruning
│   │   │   ├── audit/              Audit log service
│   │   │   ├── sdk/                SDK config endpoint
│   │   │   ├── metrics/            Prometheus metrics endpoint
│   │   │   └── user-notifications/ In-app notification bell
│   │   └── shared/
│   │       ├── guards/             ApiKeyGuard + JwtAuthGuard + TenantAuthGuard
│   │       ├── security/           SSRF guard + URL validation
│   │       ├── http/               External API fetch helpers + auth utilities
│   │       ├── template/           Notification template engine
│   │       ├── retry/              Retry policy utilities
│   │       ├── rate-limit/         Ingest rate limiting
│   │       ├── prisma/             PrismaService (pg adapter)
│   │       └── redis/              Redis provider (ioredis)
│   └── .env.example
│
├── extension/                      Chrome Extension (Manifest V3)
│   ├── public/manifest.json
│   └── src/
│       ├── background/service-worker.ts    Buffer + flush (5s / 20 events) + screenshot capture
│       ├── offscreen/offscreen.ts          Offscreen document for tab screenshots
│       ├── content/
│       │   ├── bridge.ts                   Content ↔ service worker message bridge
│       │   ├── shared.ts                   generateId, getSessionId, sendEvent, etc.
│       │   ├── error-tracker.ts            window.onerror + unhandledrejection
│       │   ├── network-tracker.ts          fetch + XHR intercept
│       │   ├── console-tracker.ts          console.log/warn/error intercept
│       │   ├── dom-tracker.ts              clicks + SPA navigation
│       │   └── replay-tracker.ts           rrweb session recording
│       ├── shared/
│       │   ├── runtime-config.ts           Remote config polling (sampling, replay toggle)
│       │   ├── sampling.ts                 Client-side event sampling
│       │   └── sanitize.ts                 PII scrubbing before sending
│       └── popup/App.tsx                   API key config + enable/pause + tab targeting
│
├── dashboard/                      React SPA (Vite + TailwindCSS)
│   └── src/
│       ├── pages/
│       │   ├── LoginPage.tsx               Login + OAuth buttons
│       │   ├── OnboardingPage.tsx          First-run setup flow
│       │   ├── ProjectsPage.tsx            Create projects, copy API key
│       │   ├── OverviewPage.tsx            Analytics + metrics overview
│       │   ├── BugsPage.tsx                Bug list with filters, bulk actions, SSE live updates
│       │   ├── BugDetailPage.tsx           AI summary, root cause, steps, fix, stack trace, AI chat
│       │   ├── ClustersPage.tsx            Semantic error clusters view
│       │   ├── SessionsPage.tsx            Sessions list with timeline
│       │   ├── ReleasesPage.tsx            Release + sourcemap management
│       │   ├── ActivityFeedPage.tsx        Audit log / activity stream
│       │   ├── IntegrationsPage.tsx        Configure Jira, GitHub, Slack, etc.
│       │   ├── RulesPage.tsx               Rule builder UI
│       │   ├── SystemHealthPage.tsx        Queue metrics + pipeline health
│       │   └── SettingsPage.tsx            Project settings + retention config
│       └── api.ts                          Typed API client
│
├── packages/
│   └── sourcemap-upload/           npm CLI: @bug-intelligence/sourcemap-upload
│       └── bin/cli.js              bi-upload-sourcemaps — uploads *.map files post-build
│
└── docker-compose.yml              PostgreSQL (pgvector) + Redis
```

---

## Getting Started

### Prerequisites

- Docker Desktop
- Node.js 20+
- Chrome browser

### 1. Start infrastructure

```bash
docker compose up -d
```

This starts:
- PostgreSQL 16 with pgvector extension on port 5432
- Redis 7 on port 6379

### 2. Configure backend

```bash
cd backend
cp .env.example .env
```

Edit `.env` and fill in:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bug_intelligence?schema=public"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="your-long-random-secret"
JWT_REFRESH_SECRET="your-refresh-secret"
AI_API_KEY="sk-ant-..."        # Anthropic key — get from console.anthropic.com
AI_MODELS="claude-haiku-4-5-20251001"
ALLOWED_ORIGINS="http://localhost:5173"
```

### 3. Run database migrations

```bash
cd backend
npm install
npm run db:generate   # generates Prisma client
npm run db:migrate    # creates all tables
```

### 4. Start the backend

```bash
npm run start:dev
```

API runs at `http://localhost:4000`. Swagger docs at `http://localhost:4000/api`.

### 5. Start the dashboard

```bash
cd dashboard
npm install
npm run dev
```

Dashboard runs at `http://localhost:5173`.

### 6. Create your first project

1. Open `http://localhost:5173` → register an account
2. Complete the onboarding flow → create a project
3. Copy the API key shown — it's only displayed once (`bi_live_<64 hex chars>`)

### 7. Install the Chrome extension

```bash
cd extension
npm install
npm run build        # outputs to extension/dist/
```

Then in Chrome:
1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `extension/dist/` folder
4. Click the JinAi icon in the toolbar
5. Paste your API key → click **Start Capture**

### 8. (Optional) Upload sourcemaps for unminified stack traces

```bash
npm install -D @bug-intelligence/sourcemap-upload
```

Add to your build script:
```json
"build": "vite build && bi-upload-sourcemaps dist"
```

Set env vars:
```bash
BUG_INTELLIGENCE_PROJECT_ID=your-project-uuid
BUG_INTELLIGENCE_API_KEY=bi_live_xxx
BUG_INTELLIGENCE_API_URL=http://localhost:4000/api/v1
```

---

## Auth Model

```
Dashboard users  →  JWT (Bearer token, 15m) + refresh (7d)   /auth/*
                    Google OAuth / GitHub OAuth               /auth/google, /auth/github
Extension        →  Project API Key (X-API-Key header)        /ingest/batch, /upload/*
```

API key format: `bi_live_{64 hex chars}` (256 bits of entropy). Only the SHA-256 hash is stored in the database. The raw key is shown once at creation.

---

## Adding a New Integration

To add Linear (or any other tracker), you need exactly **2 changes**:

**1. Create the provider** — `backend/src/modules/integrations/providers/linear.provider.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import type { IntegrationProvider, BugReportPayload, JsonValue, TicketResult } from './integration.interface';

@Injectable()
export class LinearProvider implements IntegrationProvider {
  readonly id = 'linear';
  readonly name = 'Linear';

  async validateCredentials(config: Record<string, JsonValue>): Promise<boolean> {
    // validate API key against Linear API
  }

  async createTicket(payload: BugReportPayload, config: Record<string, JsonValue>): Promise<TicketResult> {
    // POST to Linear GraphQL API
  }
}
```

**2. Register it** — add to `integration.registry.ts` and the `IntegrationsModule` providers array. The dispatch worker resolves providers by ID automatically.

---

## Key Design Decisions

### Deduplication

Errors are deduplicated at the DB level using a unique constraint:

```sql
UNIQUE (fingerprint, project_id, dedup_bucket)
-- dedup_bucket = date_trunc('hour', created_at)
```

The worker uses `INSERT ... ON CONFLICT DO NOTHING RETURNING id`. If the `RETURNING` result is empty, a duplicate was detected and processing stops — no distributed locks, no race conditions.

### AI Queue Payloads

The `ai-analysis` queue carries only IDs + fingerprint (not event data). The worker fetches context fresh from the DB at processing time. This keeps queue payloads ~200 bytes and durable across retries.

### Clustering

Each error gets a 1536-dim vector embedding. The clustering worker finds the nearest existing cluster centroid using pgvector cosine distance (`<=>`). If the distance is within the project's `clustering_threshold` (default 0.15), the error joins that cluster and the centroid is updated as a running mean. Otherwise a new cluster is created.

### Stack Unminification

When sourcemaps are uploaded via `bi-upload-sourcemaps`, the backend stores them keyed by release version. On each new error, `stack-unminifier.ts` resolves the original file name and line number before the bug is passed to the AI — so Claude always sees readable stack traces.

### Unique Users

"Unique users affected" is defined as `COUNT(DISTINCT session_id)` for a cluster within a time window — no PII required, measurable from existing data.

---

## Rule Engine

Rules trigger automatic dispatch and/or notifications when conditions are met. Supported fields:

| Field | Source | Operators |
|---|---|---|
| `error.severity` | Bug severity | `=`, `>=` |
| `error.status_code` | Last API response status | `=`, `>=` |
| `cluster.occurrences` | ErrorCluster.occurrence_count | `>`, `>=` |
| `session.unique_users` | COUNT(DISTINCT session_id) in last 60 min | `>`, `>=` |

Example rule:

```json
{
  "name": "Critical errors auto-dispatch",
  "conditions": {
    "all": [
      { "field": "error.severity", "op": ">=", "value": "high" },
      { "field": "cluster.occurrences", "op": ">", "value": 3 }
    ]
  },
  "action": "auto_dispatch"
}
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_URL` | ✅ | Redis connection string |
| `JWT_SECRET` | ✅ | Secret for signing access JWTs |
| `JWT_REFRESH_SECRET` | ✅ | Secret for signing refresh JWTs |
| `AI_API_KEY` | ✅ | Anthropic (or OpenRouter) API key |
| `AI_MODELS` | ✅ | Comma-separated model fallback chain |
| `ALLOWED_ORIGINS` | ✅ | CORS allowed origins |
| `AI_BASE_URL` | ❌ | Override for OpenAI-compatible endpoints |
| `PORT` | ❌ | Backend port (default: 4000) |
| `MERIDIAN_BASE_URL` | ❌ | Meridian 3SC base URL |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | NestJS, TypeScript, BullMQ, Prisma |
| Database | PostgreSQL 16 + pgvector |
| Cache / Queue | Redis 7 |
| AI | Anthropic Claude (Haiku), vector embeddings |
| Frontend | React 18, Vite, TailwindCSS, Framer Motion |
| Extension | Chrome Manifest V3, TypeScript, rrweb |
| Auth | JWT, Google OAuth, GitHub OAuth |
| Infra | Docker Compose, Prometheus metrics |
