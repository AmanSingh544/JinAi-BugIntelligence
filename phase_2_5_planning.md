# Phase 2.5 — Operational Maturity Engineering

> **Status:** In Progress  
> **Goal:** Transition from feature construction to operational survivability. The system must behave predictably under stress, provider degradation, and data growth.

---

## What was implemented in this pass

### 1. Retention Tier Policies ✅

**Problem:** Data grows unbounded. Replay segments, events, screenshots, and AI outputs accumulate silently, eventually affecting query performance, backup size, and storage cost.

**Solution:**
- Added 6 retention fields to `ProjectEnvironment`:
  - `retention_events_days` (default: 30)
  - `retention_sessions_days` (default: 30)
  - `retention_replay_days` (default: 7)
  - `retention_screenshots_days` (default: 14)
  - `retention_bug_detail_days` (default: 30)
  - `retention_dlq_days` (default: 14)
- Created `RetentionService` with a daily `@Cron` at 3 AM.
- Cleanup is per-environment, so staging can be more aggressive than production.
- Schema changes allow `Bug` to survive session deletion (`session_id` → nullable, `onDelete: SetNull`).
- `Error.event_id` is now nullable with `onDelete: SetNull`, so raw events can be pruned without cascading to errors/bugs.
- Orphaned sessions (with no events, errors, replay, or bugs) are automatically cleaned up.

**Files changed:**
- `backend/prisma/schema.prisma`
- `backend/src/modules/retention/retention.module.ts` (new)
- `backend/src/modules/retention/retention.service.ts` (new)
- `backend/src/modules/environments/dto/update-environment.dto.ts`
- `backend/src/modules/environments/environment.service.ts`
- `backend/src/app.module.ts`

---

### 2. Release-Aware Fingerprinting ✅

**Problem:** Fingerprints drift across releases because line numbers, webpack chunk hashes, and bundler output change even when the logical bug is identical. This creates duplicate bugs and noisy Jira tickets.

**Solution:**
- Created `fingerprintNormalizeStack()` — a stricter normalization than `normalizeStack()`:
  - Strips line/column numbers
  - Strips memory addresses
  - Strips webpack query hashes (`.js?1234` → `.js`)
  - Strips webpack chunk IDs (`[123]` → `[chunk]`)
  - Normalizes vendor paths (`node_modules/xxx/lib/index.js` → `node_modules/xxx`)
  - Collapses async wrapper prefixes and mangled name suffixes
- The fingerprint hash now uses `fingerprintNormalizeStack(unminifiedStack ?? rawStack)` instead of the display-normalized stack.
- Added an in-memory LRU cache (max 20 entries) for parsed `SourceMapConsumer` instances in `stack-unminifier.ts`. This avoids re-parsing the same sourcemap for every error in a release.

**Impact:** Same logical bug → same fingerprint across releases, dramatically reducing duplicate tickets.

**Files changed:**
- `backend/src/modules/errors/normalize-stack.ts`
- `backend/src/modules/errors/stack-unminifier.ts`
- `backend/src/modules/errors/error-detection.worker.ts`

---

### 3. AI Batching / Race-Condition Fix ✅

**Problem:** The existing Redis cache by fingerprint works for sequential jobs, but if two identical errors arrive close together, both AI analysis workers can miss the cache and trigger duplicate LLM calls. Also, embeddings were generated from raw stacks instead of normalized/unminified stacks, hurting clustering stability.

**Solution:**
- Added distributed locking via Redis `SET NX EX`:
  - First worker acquires the lock, performs the LLM call, caches the result, then releases the lock.
  - Subsequent workers detect the lock and poll the cache (up to 30s, 500ms intervals) instead of calling the LLM.
- If the lock holder fails, the lock auto-expires after 120s (with TTL).
- Embeddings now use `error.stack_unminified ?? error.stack` instead of raw stack, improving semantic clustering consistency.

**Impact:** 100 identical crashes → 1 LLM call. Same bug → same AI explanation. Lower cost, higher consistency.

**Files changed:**
- `backend/src/modules/ai-analysis/ai-analysis.worker.ts`

---

## Remaining Phase 2.5 work (prioritized)

### ✅ P0 — Retry Discipline (IMPLEMENTED)

**What changed:**
- Created `ProviderError` structured error class with `statusCode`, `retryAfterSeconds`, `isRateLimit`, `isServerError`.
- All integration providers (Jira, GitHub, Meridian) and notification providers (Slack, Email) now throw `ProviderError`.
- `parseRetryAfter` supports both delta-seconds and HTTP-date formats.
- `computeRetryDelay` implements:
  - Exponential backoff: `baseDelay * 2^(attempt - 1)`
  - Jitter: ±25% randomization to prevent thundering herds
  - Retry-After respect: parsed header is treated as minimum delay
  - Max retry horizon: 24h from first attempt
  - Max delay cap: 1 hour
- Dispatch worker checks per-integration cooldown in Redis before attempting.
- On 429/5xx, cooldown is set in Redis with exponential backoff.
- System health endpoint now exposes `cooldown` and `failures_last_5m` per provider.

**Files changed:**
- `backend/src/modules/integrations/providers/provider-error.ts` (new)
- `backend/src/shared/retry/retry-policy.ts` (new)
- `backend/src/modules/integrations/providers/jira.provider.ts`
- `backend/src/modules/integrations/providers/github.provider.ts`
- `backend/src/modules/integrations/providers/meridian-3sc.provider.ts`
- `backend/src/modules/integrations/dispatch.worker.ts`
- `backend/src/modules/notifications/providers/slack.provider.ts`
- `backend/src/modules/notifications/providers/email.provider.ts`
- `backend/src/modules/system/system.controller.ts`

---

### ✅ Cluster-First Pipeline (IMPLEMENTED)

**What changed:**
- `AiAnalysisWorker` now generates embeddings **before** calling the LLM.
- It finds/creates the semantic cluster inline (the separate `ClusteringWorker` is now unused for the main flow).
- If a cluster already has a `bug_id`, the LLM call is skipped entirely. The duplicate error is silently linked to the existing cluster.
- A cluster-level Redis lock (`cluster:lock:${clusterId}`) prevents race conditions where two similar errors simultaneously create duplicate LLM calls.
- New bugs are created only for **new clusters**.
- Schema: `ErrorCluster.bug_id` (unique, nullable) links each cluster to its canonical bug.

**Impact:** 100 similar crashes → 1 LLM call + 1 bug. AI costs drop proportionally to cluster density.

**Files changed:**
- `backend/prisma/schema.prisma`
- `backend/src/modules/ai-analysis/ai-analysis.worker.ts`
- `backend/src/modules/ai-analysis/ai-analysis.module.ts`

---

### ✅ P0 — E2E Pipeline Validation (IMPLEMENTED)

**What changed:**
- Created `PipelineTrackerService` with Redis-backed stage tracking.
- Added optional `trackingId` to all job interfaces: `ErrorDetectionJob`, `AiAnalysisJob`, `RuleEvaluationJob`, `DispatchJob`.
- Every worker propagates `trackingId` downstream and records stage timestamps.
- `POST /system/synthetic-error` creates a synthetic session + event, injects an error detection job with a tracking ID, and returns it.
- `GET /system/synthetic-error/:trackingId` returns pipeline stage timestamps and elapsed time.
- `GET /system/metrics` returns:
  - Per-stage latency stats (count, avg, p95) from Redis
  - Queue depths and stalled job detection via `QueueMetricsService`
- Stalled job detection: checks oldest waiting job per queue against SLAs:
  - ingest: 60s, error-detection: 5m, ai-analysis: 10m, clustering: 5m, rule-evaluation: 5m, dispatch: 15m

**Files changed:**
- `backend/src/modules/system/pipeline-tracker.service.ts` (new)
- `backend/src/modules/system/queue-metrics.service.ts` (new)
- `backend/src/modules/system/pipeline.module.ts` (new)
- `backend/src/modules/system/system.controller.ts`
- `backend/src/modules/errors/error-detection.queue.ts`
- `backend/src/modules/errors/error-detection.worker.ts`
- `backend/src/modules/ai-analysis/ai-analysis.queue.ts`
- `backend/src/modules/ai-analysis/ai-analysis.worker.ts`
- `backend/src/modules/rules/rule-evaluation.queue.ts`
- `backend/src/modules/rules/rule-evaluation.worker.ts`
- `backend/src/modules/integrations/dispatch.queue.ts`
- `backend/src/modules/integrations/dispatch.worker.ts`

---

### ✅ P0 — Notification Queueing (IMPLEMENTED)

**What changed:**
- Created `NotificationQueue` and `NotificationWorker` using BullMQ.
- `NotificationService.sendToProject()` now creates `pending` log entries and enqueues async jobs instead of synchronous fire-and-forget.
- `NotificationWorker` uses the same retry discipline as dispatch:
  - `ProviderError` parsing with `Retry-After` support
  - Exponential backoff + jitter via `computeRetryDelay`
  - 24h max retry horizon
  - Per-channel cooldown in Redis on 429/5xx
- `NotificationLog` status lifecycle: `pending` → `retrying` → `sent`/`failed`
- Health endpoint exposes per-channel cooldown and failure counts.

**Files changed:**
- `backend/src/modules/notifications/notification.queue.ts` (new)
- `backend/src/modules/notifications/notification.worker.ts` (new)
- `backend/src/modules/notifications/notification.service.ts`
- `backend/src/modules/notifications/notifications.module.ts`
- `backend/src/modules/system/system.controller.ts`

---

### ✅ P0 — Sourcemap Upload & Parsing Robustness (IMPLEMENTED)

**Why:** Large sourcemaps can cause memory pressure. The current implementation reads the entire file into memory and creates a new `SourceMapConsumer` per error (now cached, but still in-memory).

**Required changes:**
1. Validate sourcemap file size on upload (reject > 50MB).
2. Store sourcemap metadata (original file count, mappings size) in `Release` table.
3. Add a background job to pre-parse and cache sourcemaps in Redis after upload.
4. Fallback gracefully if sourcemap parsing fails (don’t block error detection).

**Files to change:**
- `backend/src/modules/releases/releases.controller.ts`
- `backend/src/modules/releases/releases.module.ts`
- `backend/prisma/schema.prisma` (Release model)

---

### P0 — Idempotency Hardening

**Why:** The dispatch worker has an idempotency check (`dispatch_key` unique + success check), but it’s racy. Two concurrent dispatches for the same bug/integration can both pass the check and create duplicate tickets.

**Required changes:**
1. Use a Redis distributed lock (`SET NX`) around the dispatch attempt, keyed by `dispatch_key`.
2. Ensure the lock is released even if the provider call throws.
3. Add a unique index on `(bug_id, integration_id, status = 'success')` at the DB level.

**Files to change:**
- `backend/src/modules/integrations/dispatch.worker.ts`

---

### P1 — Fingerprint Stabilization Metrics

**Why:** We need to measure whether the release-aware fingerprinting is actually working.

**Required changes:**
1. Track `fingerprint_stability_score` per project: `% of errors in the last 7 days that matched an existing fingerprint`.
2. Track `duplicate_bug_rate`: `% of bugs created that share a fingerprint with an existing bug in the last 30 days`.
3. Expose these on the dashboard and health endpoint.

**Files to change:**
- `backend/src/modules/dashboard/dashboard.module.ts` (or new analytics module)
- `dashboard/src/pages/SystemHealthPage.tsx`

---

## Architecture decisions locked in

1. **BullMQ + Postgres + Redis is enough** — No Kafka, ClickHouse, or K8s needed yet.
2. **Bounded replay** — Rolling 30s buffer, flush-on-error, discard-on-success. No full-session archival.
3. **Environment-driven runtime config** — `/sdk/config` + `config_version` enables kill switches, sampling changes, and replay rollout without extension redeploy.
4. **Async pipeline** — Ingest → Detection → AI → Dispatch → Notifications. No synchronous coupling.
5. **Retention as policy, not afterthought** — Configurable per environment, cron-enforced, with safe cascading rules.

---

## Trust infrastructure checklist

| Capability | Status | Notes |
|-----------|--------|-------|
| Deterministic fingerprinting | ✅ | `fingerprintNormalizeStack` + sourcemap cache |
| AI result deduplication | ✅ | Redis lock + cache by fingerprint |
| Data retention / pruning | ✅ | Daily cron, per-environment tiers |
| **Cluster-first AI pipeline** | ✅ | Embedding → Clustering → conditional LLM. One bug per cluster. |
| **Retry-After parsing** | ✅ | All providers parse `Retry-After` and throw structured `ProviderError`. |
| **Exponential backoff with jitter** | ✅ | `computeRetryDelay` with `baseDelay * 2^(attempt-1)` + 25% jitter. |
| **Max retry horizon** | ✅ | 24h cap from first attempt. Dead-lettered if exceeded. |
| **Provider cooldown state** | ✅ | Redis per-integration cooldown on 429/5xx. Health endpoint exposes it. |
| **E2E pipeline validation** | ✅ | Synthetic error injection, per-stage latency tracking, queue stall detection. |
| **Teams notification channel** | ✅ | Added `teams` provider with MessageCard webhook support. |
| **Notification queueing + retry** | ✅ | Async BullMQ worker with `pending`/`retrying`/`sent`/`failed` states, cooldown, jitter. |
| **Sourcemap upload robustness** | ✅ | 50MB limit, pre-parse validation, `sourcemap_parsed`/`sourcemap_error` metadata, graceful fallback. |
| **E2E pipeline validation** | ✅ | Synthetic error injection + per-stage latency + stalled job detection. |
| Notification queueing + retry | ❌ | P2 |
| E2E synthetic validation | ✅ | `POST /system/synthetic-error` + stage tracking |
| Idempotent dispatch (distributed lock) | ❌ | P2 |
| Sourcemap upload limits | ❌ | P1 |
| Fingerprint stability metrics | ❌ | P3 |
| DLQ management UI | ❌ | Stub exists in SystemController |
| Queue hygiene (stalled job detection) | ✅ | `QueueMetricsService` with per-queue SLA checks |

---

## Migration notes

Run the following to apply schema changes:

```bash
cd backend
npx prisma db push
npx prisma generate
```

For production, create a proper migration instead of `db push`:

```bash
npx prisma migrate dev --name add_retention_and_fingerprinting
```

> ⚠️ The current dev database has drift (tables were added via `db push` earlier). Before production deployment, baseline migrations or reset to a clean migration history is recommended.
