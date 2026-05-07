# Bug Intelligence Platform

An AI-powered browser observability and bug intelligence platform. Install the Chrome extension on any website you're testing — errors are automatically captured, deduplicated, analyzed by AI, clustered, and dispatched to your issue tracker.

---

## How It Works

```
Browser (extension)
  └─ captures errors, clicks, network calls, console logs
      └─ POST /api/v1/ingest/batch  (X-API-Key auth)
          └─ [ingest queue]  →  IngestWorker
              └─ saves events + session to DB
              └─ [error-detection queue]  →  ErrorDetectionWorker
                  └─ fingerprints + deduplicates (DB-level unique constraint)
                  └─ [ai-analysis queue]  →  AiAnalysisWorker
                      └─ checks Redis cache by fingerprint
                      └─ fetches last 20 session events from DB
                      └─ calls Claude Haiku → structured Bug record
                      └─ generates embedding
                      └─ [clustering queue]  →  ClusteringWorker
                          └─ pgvector KNN → assigns/creates ErrorCluster
                      └─ [rule-evaluation queue]  →  RuleEvaluationWorker
                          └─ evaluates project rules (severity, occurrences, unique users)
                          └─ on match → [dispatch queue]  →  DispatchWorker
                              └─ calls IntegrationProvider (Meridian / Jira / GitHub)
                              └─ retries with backoff [0s, 30s, 5m, 30m, 2h]
                              └─ dead after 5 attempts → DLQ
```

---

## Project Structure

```
Extension--/
├── backend/                  NestJS API + all workers
│   ├── prisma/
│   │   └── schema.prisma     Full DB schema (all tables)
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/         JWT login/register + API key generation
│   │   │   ├── projects/     Project CRUD + API key rotation
│   │   │   ├── ingest/       POST /ingest/batch → BullMQ → IngestWorker
│   │   │   ├── errors/       ErrorDetectionWorker (fingerprint + dedup)
│   │   │   ├── ai-analysis/  AiAnalysisWorker + PromptService
│   │   │   ├── clustering/   ClusteringWorker (pgvector KNN)
│   │   │   ├── rules/        RuleEvaluationWorker + rule-evaluator
│   │   │   ├── integrations/ DispatchWorker + provider registry
│   │   │   │   └── providers/
│   │   │   │       ├── integration.interface.ts   IntegrationProvider interface
│   │   │   │       ├── integration.registry.ts    Provider registry
│   │   │   │       ├── meridian-3sc.provider.ts   ✅ Real implementation
│   │   │   │       ├── jira.provider.ts            🔲 Phase 2 stub
│   │   │   │       └── github.provider.ts          🔲 Phase 2 stub
│   │   │   ├── sessions/     GET /projects/:id/sessions
│   │   │   └── bugs/         GET/PATCH /projects/:id/bugs
│   │   └── shared/
│   │       ├── guards/       ApiKeyGuard + JwtAuthGuard
│   │       ├── prisma/       PrismaService (pg adapter)
│   │       └── redis/        Redis provider (ioredis)
│   └── .env.example
│
├── extension/                Chrome Extension (Manifest V3)
│   ├── public/manifest.json
│   └── src/
│       ├── background/service-worker.ts   Buffer + flush (5s / 20 events)
│       ├── content/
│       │   ├── shared.ts                  generateId, getSessionId, sendEvent, etc.
│       │   ├── error-tracker.ts           window.onerror + unhandledrejection
│       │   ├── network-tracker.ts         fetch + XHR intercept
│       │   ├── console-tracker.ts         console.log/warn/error intercept
│       │   └── dom-tracker.ts             clicks + SPA navigation
│       └── popup/App.tsx                  API key config + enable/pause toggle
│
├── dashboard/                React SPA (Vite)
│   └── src/
│       ├── pages/
│       │   ├── LoginPage.tsx
│       │   ├── ProjectsPage.tsx     Create projects, copy API key
│       │   ├── SessionsPage.tsx     Sessions list per project
│       │   ├── BugsPage.tsx         Bug list with severity/status filters
│       │   └── BugDetailPage.tsx    AI summary, root cause, steps, fix, stack trace
│       └── api.ts                   Typed API client
│
└── docker-compose.yml        PostgreSQL (pgvector) + Redis
```

---

## Getting Started

### Prerequisites

- Docker Desktop
- Node.js 20+
- Chrome browser

### 1. Start infrastructure

```bash
cd Extension--
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
ANTHROPIC_API_KEY="sk-ant-..."   # get from console.anthropic.com
```

### 3. Run database migrations

```bash
cd backend
npm install
npm run db:generate   # generates Prisma client
npm run db:migrate    # runs migrations (creates all tables)
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
2. Create a project — copy the API key shown (it's only shown once)
3. Note the project's API key: `bi_live_<64 hex chars>`

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
4. Click the Bug Intelligence icon in the toolbar
5. Paste your API key → click **Start Capture**

---

## Auth Model

```
Dashboard users  →  JWT (Bearer token)       login/register at /auth/*
Extension        →  Project API Key          X-API-Key header on /ingest/batch
```

The API key is the real security boundary. `allowed_origins` is a soft DX filter — set `block_unknown_origins: true` on a project to hard-enforce it.

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

**2. Register it** — add to `integration.registry.ts`:

```typescript
constructor(meridian: MeridianProvider, jira: JiraProvider, github: GitHubProvider, linear: LinearProvider) {
  this.providers = new Map<string, IntegrationProvider>([
    [meridian.id, meridian],
    [jira.id, jira],
    [github.id, github],
    [linear.id, linear],   // ← add this
  ]);
}
```

And add `LinearProvider` to the `IntegrationsModule` providers array. That's it — the dispatch worker resolves providers by ID automatically.

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

Each error gets a 1536-dim embedding. The clustering worker finds the nearest existing cluster centroid using pgvector cosine distance (`<=>`). If the distance is within the project's `clustering_threshold` (default 0.15), the error joins that cluster and the centroid is updated as a running mean. Otherwise a new cluster is created.

### Unique Users

"Unique users affected" is defined as `COUNT(DISTINCT session_id)` for a cluster within a time window — no PII required, measurable from existing data.

---

## Rule Engine (Phase 1)

Rules trigger automatic dispatch when conditions are met. Supported fields:

| Field | Source | Operators |
|---|---|---|
| `error.severity` | Bug severity | `=`, `>=` |
| `error.status_code` | Last API response status | `=`, `>=` |
| `cluster.occurrences` | ErrorCluster.occurrence_count | `>`, `>=` |
| `session.unique_users` | COUNT(DISTINCT session_id) in last 60 min | `>`, `>=` |

Example rule (create via DB or future Rules API):

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
| `JWT_SECRET` | ✅ | Secret for signing dashboard JWTs |
| `ANTHROPIC_API_KEY` | ✅ | Anthropic API key for Claude Haiku |
| `PORT` | ❌ | Backend port (default: 4000) |

---

## Phase 2 (not yet built)

- Session replay (rrweb)
- Screenshot auto-capture
- Real Jira and GitHub provider implementations
- Nested rule conditions (`any` / `all`)
- Slack / email notification channel
- AI debug chat
