# Bug Intelligence Platform — Full Architecture Plan (v4, final)

## Context

Standalone AI-powered browser observability + bug intelligence platform.
- Works on **any website** a developer tests
- Auth: **Project API Key** (real auth boundary)
- 3SC Meridian, Jira, GitHub = integration outputs via provider pattern
- Core loop: `extension event → ingest → detect error → AI summary → bug → dispatch`

---

## 1. Security & Auth Boundaries

**API key is the real authorization boundary.** `allowed_origins` is a soft DX filter — not a security gate.

```
Real security:  X-API-Key → SHA-256 lookup → Project (rate limited)
Soft filter:    allowed_origins[] → log mismatch, block if project.block_unknown_origins = true
```

API key format: `bi_live_{64 hex chars}` (256 bits entropy).
Store only `SHA-256(raw_key)` in DB. Raw key shown once at creation.

---

## 2. Exact Job Contracts

### Queue 1: `ingest`

**Produced by:** `IngestController.batch()`
**Consumed by:** `IngestWorker`

```typescript
interface IngestJob {
  projectId: string;
  sessionId: string;
  events: RawEvent[];       // validated against BaseEvent schema, max 100
  receivedAt: number;       // server Unix ms — not trusted from client
}
```

**Worker responsibilities:**
1. Batch INSERT into `events` (single transaction)
2. Upsert `session` row
3. For each `event.type === 'error'` → push `ErrorDetectionJob` to queue `error-detection`
4. Acknowledge

---

### Queue 2: `error-detection`

**Produced by:** `IngestWorker`
**Consumed by:** `ErrorDetectionWorker`

```typescript
interface ErrorDetectionJob {
  projectId: string;
  sessionId: string;
  eventId: string;
  errorPayload: {
    message: string;
    stack?: string;
    file?: string;
    line?: number;
    column?: number;
  };
}
```

**Worker responsibilities:**
1. Compute `fingerprint = SHA-256(message + normalizeStack(stack))`
2. Idempotent upsert into `errors` table:
   ```sql
   INSERT INTO errors (...) VALUES (...)
   ON CONFLICT (fingerprint, project_id, dedup_bucket)
   DO NOTHING
   RETURNING id
   ```
   where `dedup_bucket = date_trunc('hour', now())` — eliminates race conditions, no application-level locking needed
3. If INSERT returned no row (conflict = already deduped) → acknowledge job, stop
4. If new row created → push `AiAnalysisJob`
5. Acknowledge

---

### Queue 3: `ai-analysis`

**Produced by:** `ErrorDetectionWorker`
**Consumed by:** `AiAnalysisWorker`

**Job carries only IDs and fingerprint — no bulk event data in queue payload:**

```typescript
interface AiAnalysisJob {
  projectId: string;
  sessionId: string;
  errorId: string;
  fingerprint: string;      // for cache lookup
}
```

**Worker queries DB for context (not passed in job):**

```typescript
// Inside AiAnalysisWorker.process():
const recentEvents = await eventsRepo.findRecentBefore(
  sessionId,
  errorEvent.timestamp,
  { limit: 20 }            // last 20 events before this error
);
const lastApiCall = recentEvents.findLast(e => e.type === 'api_response');
```

This keeps queue payloads small (~200 bytes) and durable. Context is always fresh from DB.

**Worker responsibilities:**
1. Check Redis: `ai:result:{fingerprint}` → HIT → reuse, skip LLM, still create Bug record
2. MISS → load active `AiPromptVersion` from DB
3. Call LLM with context fetched from DB → validate JSON output
4. On LLM failure: retry (max 3, exponential backoff); all fail → Bug with `status = 'ai_failed'`
5. On success:
   - INSERT `Bug` with `ai_model_version`
   - Generate embedding → UPDATE `errors.vector`
   - Cache: `SETEX ai:result:{fingerprint} 86400 <result>`
   - Push `ClusteringJob`
   - Push `RuleEvaluationJob`

**LLM output contract:**
```typescript
interface AiAnalysisResult {
  summary: string;
  rootCause: string;
  stepsToReproduce: string[];
  fixSuggestion: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}
```

---

### Queue 4: `clustering`

**Produced by:** `AiAnalysisWorker`
**Consumed by:** `ClusteringWorker`

```typescript
interface ClusteringJob {
  projectId: string;
  errorId: string;
  vector: number[];         // 1536-dim embedding
}
```

**Worker responsibilities:**
1. KNN query: nearest cluster centroid within project, below `project.clustering_threshold`
2. Within threshold → assign cluster, update centroid (running mean), increment count
3. No match → create new `ErrorCluster`
4. UPDATE `errors.cluster_id`

---

### Queue 5: `rule-evaluation`

**Produced by:** `AiAnalysisWorker`
**Consumed by:** `RuleEvaluationWorker`

```typescript
interface RuleEvaluationJob {
  projectId: string;
  bugId: string;
  errorId: string;
  clusterId: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}
```

**Worker responsibilities:**
1. Load active rules for project
2. Evaluate each rule's conditions against metrics (see Rule Engine section)
3. On match → execute action
4. Log to `RuleExecutionLog`

---

### Queue 6: `dispatch`

**Produced by:** `RuleEvaluationWorker` or manual dashboard trigger
**Consumed by:** `DispatchWorker`

```typescript
interface DispatchJob {
  bugId: string;
  integrationId: string;
  attempt: number;          // starts at 1
}
```

**Worker responsibilities:**
1. Load Bug + ProjectIntegration
2. Build `BugReportPayload`
3. Resolve provider from registry
4. Call `provider.createTicket(payload, integration.config)`
5. Success → UPDATE `IntegrationDelivery.status = 'success'`
6. Failure → reschedule with backoff: `[0s, 30s, 5m, 30m, 2h]`
7. attempt === 5 → mark `'dead'`, push to DLQ `dispatch-dlq`, send developer notification

---

## 3. TypeScript Types (strict, no `any`)

```typescript
type JsonValue =
  | string | number | boolean | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type EventType = 'click' | 'input' | 'navigation' | 'api_request' | 'api_response' | 'error' | 'console';

interface BaseEvent {
  id: string;
  sessionId: string;
  timestamp: number;        // Unix ms, client-side
  type: EventType;
  url: string;
}

interface ErrorEvent extends BaseEvent {
  type: 'error';
  payload: { message: string; stack?: string; file?: string; line?: number; column?: number; };
}

interface ApiEvent extends BaseEvent {
  type: 'api_request' | 'api_response';
  payload: { url: string; method: string; status?: number; duration?: number; requestBody?: JsonValue; responseBody?: JsonValue; };
}

interface ClickEvent extends BaseEvent {
  type: 'click';
  payload: { tag: string; text?: string; selector: string; };
}

interface ConsoleEvent extends BaseEvent {
  type: 'console';
  payload: { level: 'log' | 'warn' | 'error'; message: string; };
}

type RawEvent = ErrorEvent | ApiEvent | ClickEvent | ConsoleEvent;
```

---

## 4. "Unique Users" — Precise Definition

For a browser extension that runs on anonymous pages, there is no reliable user identity.
The concrete definition is: **unique `sessionId` values per `cluster_id` within a time window.**

Each new page load generates a new `sessionId` (UUID via `crypto.randomUUID()`).
"3 unique users affected" means ≥ 3 distinct sessions hit the same error cluster within the rule's time window.

This is:
- Measurable without any PII
- Unambiguous at query time
- Privacy-safe by default

Rule field `session.unique_users` resolves to:
```sql
SELECT COUNT(DISTINCT session_id) FROM errors
WHERE cluster_id = ? AND created_at >= NOW() - INTERVAL '<time_window> minutes'
```

---

## 5. Dedup — Idempotency Strategy

Race condition: two workers process the same error within milliseconds of each other, both pass the fingerprint check in application code, both try to INSERT.

**Solution: DB-level unique constraint, not application-level check.**

```sql
errors table:
  UNIQUE (fingerprint, project_id, dedup_bucket)
  -- dedup_bucket = date_trunc('hour', created_at)
```

Worker uses:
```sql
INSERT INTO errors (fingerprint, project_id, dedup_bucket, ...)
VALUES (...)
ON CONFLICT (fingerprint, project_id, dedup_bucket) DO NOTHING
RETURNING id;
```

If `RETURNING id` is empty → conflict occurred → this worker stops (idempotent).
No distributed locks, no Redis coordination, no race conditions.

---

## 6. Rule Engine (intentionally minimal — Phase 1)

### Supported fields (Phase 1 only)

| Field | Source | Type | Operators |
|-------|--------|------|-----------|
| `error.severity` | `Bug.severity` | enum | `=`, `>=` |
| `error.status_code` | last `api_response.payload.status` | number | `=`, `>=` |
| `cluster.occurrences` | `ErrorCluster.occurrence_count` | number | `>`, `>=` |
| `session.unique_users` | COUNT(DISTINCT session_id) for cluster | number | `>`, `>=` |

```typescript
interface RuleCondition {
  field: 'error.severity' | 'error.status_code' | 'cluster.occurrences' | 'session.unique_users';
  op: '=' | '>=' | '<=' | '>';
  value: string | number;
}

interface RuleConditions {
  all: RuleCondition[];   // all must match; no nested any/all in Phase 1
}
```

Actions: `'auto_dispatch' | 'notify' | 'ignore'`

---

## 7. Integration Provider Pattern

```typescript
interface IntegrationProvider {
  id: string;
  name: string;
  validateCredentials(config: Record<string, JsonValue>): Promise<boolean>;
  createTicket(payload: BugReportPayload, config: Record<string, JsonValue>): Promise<{ ticketId: string; url: string }>;
  updateTicket?(ticketId: string, payload: Partial<BugReportPayload>, config: Record<string, JsonValue>): Promise<void>;
}

interface BugReportPayload {
  bugId: string; projectId: string;
  summary: string; rootCause: string;
  stepsToReproduce: string[]; fixSuggestion: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  errorMessage: string; stackTrace?: string;
  sessionUrl: string; screenshotUrl?: string;
  affectedUrl: string; browser: string;
  timestamp: string; sessionId: string;
}
```

**Phase 1 providers:**
- `MeridianProvider` — real implementation (POST to 3SC `/api/v1/tickets`)
- `JiraProvider` — interface stub, throws `NotImplementedException` until Phase 2
- `GitHubProvider` — interface stub

**Phase 2:** implement stubs. Adding Linear = 1 file + 1 registry line.

---

## 8. Database Schema

```sql
User         { id uuid PK, email unique, password_hash, created_at }

Project {
  id uuid PK, user_id FK → User,
  name,
  api_key_hash unique,
  allowed_origins text[],
  block_unknown_origins boolean DEFAULT false,
  clustering_threshold float DEFAULT 0.15,  -- configurable per project
  created_at
}

Session {
  id uuid PK, project_id FK → Project,
  started_at timestamptz, ended_at timestamptz nullable,
  user_agent, initial_url,
  metadata jsonb
  -- index: (project_id, started_at DESC)
}

Event {
  id uuid PK, session_id FK → Session, project_id FK → Project,
  type text NOT NULL, timestamp bigint NOT NULL, payload jsonb NOT NULL
  -- index: (project_id, session_id, timestamp)
}

Error {
  id uuid PK, session_id FK, project_id FK, event_id FK → Event,
  message text, stack text,
  fingerprint text NOT NULL,
  dedup_bucket timestamptz NOT NULL,  -- date_trunc('hour', created_at)
  vector vector(1536),
  cluster_id uuid nullable FK → ErrorCluster,
  created_at timestamptz DEFAULT now()
  -- UNIQUE (fingerprint, project_id, dedup_bucket)
  -- index: (project_id, fingerprint)
}

ErrorCluster {
  id uuid PK, project_id FK → Project,
  centroid vector(1536),
  label text,
  occurrence_count int DEFAULT 1,
  last_seen_at timestamptz,
  created_at timestamptz
}

Bug {
  id uuid PK, project_id FK, session_id FK, error_id FK → Error,
  summary, root_cause, steps_to_reproduce jsonb,
  fix_suggestion, severity,
  screenshot_url, replay_url,
  status text DEFAULT 'open',  -- 'open'|'dispatched'|'resolved'|'ignored'|'ai_failed'
  ai_model_version,
  ai_raw_output jsonb,
  created_at timestamptz
}

AiPromptVersion {
  id uuid PK, version text UNIQUE,
  system_prompt text, user_prompt_template text,
  is_active boolean DEFAULT false,
  created_at timestamptz
}

ProjectIntegration {
  id uuid PK, project_id FK → Project,
  provider_id text,           -- 'meridian_3sc'|'jira'|'github'
  config jsonb,               -- provider-specific, encrypted at app layer
  is_active boolean,
  created_at timestamptz
}

IntegrationDelivery {
  id uuid PK, integration_id FK, bug_id FK,
  status text,                -- 'success'|'failed'|'retrying'|'dead'
  remote_ticket_id, remote_ticket_url,
  response jsonb, attempts int DEFAULT 0,
  next_retry_at timestamptz nullable,
  created_at timestamptz
}

Rule {
  id uuid PK, project_id FK, name,
  conditions jsonb,           -- RuleConditions shape
  action text,                -- 'auto_dispatch'|'notify'|'ignore'
  is_active boolean DEFAULT true
}

RuleExecutionLog {
  id uuid PK, rule_id FK, bug_id FK,
  matched boolean, action_taken text nullable,
  created_at timestamptz
}
```

---

## 9. Rate Limiting

```typescript
const INGEST_LIMITS = {
  requestsPerMinute: 60,      // per project, sliding window in Redis
  maxPayloadBytes: 512_000,
  maxEventsPerBatch: 100,
};
// Redis key: ratelimit:ingest:{projectId}
// Exceeded → 429 Retry-After
// Payload too large → 413
```

---

## 10. Project Structure

```
bug-intelligence/
├── backend/
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   ├── projects/
│   │   │   ├── ingest/
│   │   │   │   ├── ingest.controller.ts
│   │   │   │   ├── ingest.queue.ts
│   │   │   │   └── ingest.worker.ts
│   │   │   ├── sessions/
│   │   │   ├── events/
│   │   │   ├── errors/
│   │   │   │   ├── errors.worker.ts     (error-detection queue)
│   │   │   │   └── normalize-stack.ts
│   │   │   ├── clustering/
│   │   │   │   └── clustering.worker.ts
│   │   │   ├── ai-analysis/
│   │   │   │   ├── ai-analysis.worker.ts
│   │   │   │   └── prompt.service.ts
│   │   │   ├── rules/
│   │   │   │   ├── rule-evaluation.worker.ts
│   │   │   │   └── rule-evaluator.ts
│   │   │   ├── bugs/
│   │   │   ├── integrations/
│   │   │   │   ├── providers/
│   │   │   │   │   ├── integration.interface.ts
│   │   │   │   │   ├── integration.registry.ts
│   │   │   │   │   ├── meridian-3sc.provider.ts
│   │   │   │   │   ├── jira.provider.ts   (stub)
│   │   │   │   │   └── github.provider.ts (stub)
│   │   │   │   ├── dispatch.worker.ts
│   │   │   │   └── integrations.controller.ts
│   │   │   └── dashboard/
│   │   └── shared/
│   │       ├── guards/api-key.guard.ts
│   │       ├── guards/jwt-auth.guard.ts
│   │       ├── rate-limit/ingest-rate-limit.service.ts
│   │       ├── prisma/
│   │       └── redis/
│   └── prisma/schema.prisma
│
├── extension/
│   ├── manifest.json
│   └── src/
│       ├── background/service-worker.ts   # buffer + flush
│       ├── content/error-tracker.ts
│       ├── content/network-tracker.ts
│       ├── content/dom-tracker.ts
│       ├── content/console-tracker.ts
│       └── popup/App.tsx
│
└── dashboard/
    └── src/pages/
        ├── ProjectsPage.tsx
        ├── SessionsPage.tsx
        ├── BugsPage.tsx
        ├── IntegrationsPage.tsx
        ├── RulesPage.tsx
        └── SettingsPage.tsx
```

---

## 11. Phase 1 Build Order

These 10 steps and nothing else — deliver the core loop first:

1. **Backend scaffold** — NestJS, Prisma schema (all tables above), Redis, Docker Compose
2. **Auth** — dashboard JWT (signup/login) + API key gen + `ApiKeyGuard`
3. **Ingest pipeline** — `POST /ingest/batch` → rate limit → BullMQ `ingest` queue → `IngestWorker` → Postgres
4. **Error detection** — `ErrorDetectionWorker`: fingerprint + DB-level dedup upsert → `error-detection` queue
5. **Extension Phase 1** — manifest.json + error/network/console/click trackers + service-worker batching
6. **AI analysis** — `AiAnalysisWorker`: cache check → DB context fetch → LLM → `Bug` record + embedding
7. **Clustering** — `ClusteringWorker`: pgvector KNN + centroid update
8. **Rule evaluation** — `RuleEvaluationWorker`: `all` conditions evaluator + `auto_dispatch` action
9. **Integration dispatch** — `DispatchWorker` + `MeridianProvider` (real) + stubs + DLQ
10. **Dashboard Phase 1** — Projects, Sessions list, Bug detail (AI summary + cluster info)

---

## 12. Explicitly Out of Phase 1

- Session replay (rrweb) — Phase 2
- Screenshot auto-capture — Phase 2
- Real Jira / GitHub provider implementations — Phase 2
- `any/all` nested rule conditions — Phase 2
- TimescaleDB / ClickHouse migration — when volume demands it
- AI debug chat — Phase 3
- Slack / email notification channel — Phase 3