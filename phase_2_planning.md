# Phase 2 Implementation Plan — Bug Intelligence Platform

## Overview

Phase 2 turns the MVP core loop into a production-ready observability platform. The focus is on **integrations**, **rule automation**, **visual context** (screenshots + replay), **notifications**, **production resilience**, and **release tracking**.

**Key principles:**
- Session replay and screenshots are **opt-in, bounded features** — not default-on.
- The highest-value additions are **release tracking + sourcemaps, environment support, PII sanitization, sampling controls, DLQ visibility, and idempotency**.
- Heavy infrastructure (Kafka, K8s, ClickHouse, cold storage) stays deferred.

**Estimated scope:** 9 workstreams, ~60 files touched across backend/extension/dashboard.

---

## Tiering: Core vs Stretch

| Tier | Items | When |
|---|---|---|
| **Phase 2 Core** | Integrations, rules, opt-in screenshots, opt-in replay, notifications, environments, sampling, PII sanitization, SDK config, idempotency, DLQ UI, AI confidence, release tracking, sourcemaps, health dashboard | Build now |
| **Phase 2 Stretch** | Cluster labeling worker, cluster-centric dashboard, session timeline view | Build if time permits |
| **Phase 2.5** | Circuit breakers for providers | First follow-up after Phase 2 |
| **Phase 3** | AI debug chat, semantic duplicate detection, regression detection, cold storage, partitioned tables, async embedding queue, Prometheus/Grafana | Future |

---

## Workstream 1: Real Integration Providers (Jira + GitHub)

**Goal:** Replace JiraProvider and GitHubProvider stubs with real API implementations.

### 1.1 JiraProvider
**File:** `backend/src/modules/integrations/providers/jira.provider.ts`
- Implement `validateCredentials(config)` — test Jira Cloud auth via `GET /rest/api/3/myself` using Basic Auth (`email:apiToken` base64).
- Implement `createTicket(payload, config)` — `POST /rest/api/3/issue` with fields: `project.key`, `summary`, `description` (Atlassian Document Format), `issuetype.name=Bug`, `priority` mapped from severity.
- Config shape: `{ domain: string, email: string, apiToken: string, projectKey: string }`.

### 1.2 GitHubProvider
**File:** `backend/src/modules/integrations/providers/github.provider.ts`
- Implement `validateCredentials(config)` — `GET /user` with `Authorization: token {personalAccessToken}`.
- Implement `createTicket(payload, config)` — `POST /repos/{owner}/{repo}/issues` with `title`, `body` (markdown), `labels`.
- Config shape: `{ owner: string, repo: string, token: string }`.

---

## Workstream 2: Integration Management API + Dashboard UI

**Goal:** Let users connect Jira/GitHub/Meridian to a project from the dashboard.

### 2.1 Backend — IntegrationsController
**New file:** `backend/src/modules/integrations/integrations.controller.ts`
Endpoints (JWT-guarded):
- `GET /api/v1/projects/:projectId/integrations` — list
- `POST /api/v1/projects/:projectId/integrations` — create
- `POST /api/v1/projects/:projectId/integrations/:id/validate` — test credentials
- `PATCH /api/v1/projects/:projectId/integrations/:id` — update / toggle
- `DELETE /api/v1/projects/:projectId/integrations/:id` — delete
- `GET /api/v1/integrations/providers` — list available providers

### 2.2 Dashboard — IntegrationsPage
**New file:** `dashboard/src/pages/IntegrationsPage.tsx`
- List, add, test, toggle, delete integrations.
- Dynamic config forms per provider.

---

## Workstream 3: Nested Rule Engine + Rule Management UI

**Goal:** Support `any`/`all` nested conditions and let users create/edit rules.

### 3.1 RuleEvaluator v2
**File:** `backend/src/modules/rules/rule-evaluator.ts`
- Recursive evaluation for nested `any`/`all` groups.
- Backward compatible with flat `{ all: [...] }`.

### 3.2 RulesController + DTOs
**New files:** `backend/src/modules/rules/rules.controller.ts`, `dto/*.ts`
- Full CRUD + toggle active.

### 3.3 Dashboard — RulesPage
**New file:** `dashboard/src/pages/RulesPage.tsx`
- Simple row-based condition builder.
- One level of any/all grouping — avoid full visual logic editor.

---

## Workstream 4: Project Environments + SDK Config + Sampling

**Goal:** Support `development | staging | production`. Extension fetches runtime config. Sampling per event type.

### 4.1 Schema
**File:** `backend/prisma/schema.prisma`
```prisma
model ProjectEnvironment {
  id                    String   @id @default(uuid()) @db.Uuid
  project_id            String   @db.Uuid
  name                  String   // 'development' | 'staging' | 'production'
  config_version        Int      @default(1)
  sampling_click        Float    @default(1.0)
  sampling_navigation   Float    @default(1.0)
  sampling_console      Float    @default(1.0)
  sampling_api          Float    @default(1.0)
  sampling_error        Float    @default(1.0)
  replay_enabled        Boolean  @default(false)
  screenshot_on_error   Boolean  @default(false)
  created_at            DateTime @default(now()) @db.Timestamptz

  project  Project   @relation(fields: [project_id], references: [id], onDelete: Cascade)
  sessions Session[]

  @@unique([project_id, name])
}
```
- Add `environment_id String?` to `Session`.
- Remove `replay_enabled` and `screenshot_on_error` from `Project` (moved to environment).

### 4.2 SDK Config Endpoint
**New endpoint:** `GET /api/v1/sdk/config`
- Auth: `X-API-Key` + optional `X-BI-Environment` header.
- Returns:
  ```json
  {
    "version": 3,
    "environment": "production",
    "sampling": {
    "click": 0.2,
    "navigation": 0.2,
    "console": 0.1,
    "api": 1.0,
    "error": 1.0
  },
    "replayEnabled": false,
    "screenshotOnError": true
  }
  ```
- `config_version` increments on every environment update. Extension checks `version` to detect stale config.

### 4.3 Extension — Config Fetch + Versioning
**File:** `extension/src/background/service-worker.ts`
- On init (and every 60s), `GET /sdk/config`.
- Store `{ config, version, fetchedAt }` in `chrome.storage.local`.
- If server `version > local version`, immediately apply new config.
- All trackers read config from storage before deciding to record.
- Apply per-event-type sampling:
  - `error` events: always send (`sampling_error` effectively 1.0).
  - `click`: sample via `Math.random() < sampling_click`.
  - `navigation`: sample via `Math.random() < sampling_navigation`.
  - `console`: sample via `Math.random() < sampling_console`.
  - `api_request`, `api_response`: sample via `Math.random() < sampling_api`.
- Include `X-BI-Environment: <env>` header in all ingest requests.

### 4.4 Ingest Pipeline — Environment Resolution
**File:** `backend/src/modules/ingest/ingest.controller.ts`
- Read `X-BI-Environment` header, resolve to `ProjectEnvironment`.
- Apply sampling server-side as a safety net (extension sampling is primary).
- Attach `environment_id` to session on upsert.

### 4.5 Dashboard — Environment Management
**File:** `dashboard/src/pages/ProjectsPage.tsx` or Settings
- Create/edit environments per project.
- Set sampling rates per event type.
- Toggle replay, screenshot per environment.
- Display current `config_version`.

---

## Workstream 5: Release Tracking + Sourcemaps

**Goal:** Tag errors with release version. Upload sourcemaps so minified stacks resolve to real files. This is the single most valuable product upgrade in Phase 2.

### 5.1 Schema
**File:** `backend/prisma/schema.prisma`
```prisma
model Release {
  id         String   @id @default(uuid()) @db.Uuid
  project_id String   @db.Uuid
  version    String   // e.g. "1.2.3" or git sha
  sourcemap  String?  // path to uploaded sourcemap file
  metadata   Json?    // { branch, commit, ci_run_id }
  created_at DateTime @default(now()) @db.Timestamptz

  project Project @relation(fields: [project_id], references: [id], onDelete: Cascade)
  errors  Error[]

  @@unique([project_id, version])
}

model Error {
  // ... existing fields ...
  release_id String? @db.Uuid
  release    Release? @relation(fields: [release_id], references: [id])
}
```

### 5.2 Extension — Release Tagging
**File:** `extension/src/content/shared.ts`
- Read `data-bi-release` from `<html>` or `window.__BI_RELEASE__`.
- Send release once at session init (in session metadata), not on every event.
- Extension may optionally override per-event, but session default is the normal path.

**File:** `extension/src/background/service-worker.ts`
- Include `release` in `sessionMeta` payload when posting batch.
- Do not bloat every event with release string.

### 5.3 Backend — Sourcemap Upload
**New endpoint:** `POST /api/v1/projects/:projectId/releases`
- Accept `{ version, metadata? }` + multipart sourcemap file.
- Store sourcemap to `uploads/sourcemaps/{projectId}/{version}.map`.
- **Hard limit:** reject files > 10MB. Return `413` if exceeded.
- Create `Release` row.

### 5.4 Backend — Stack Unminification
**New file:** `backend/src/modules/errors/stack-unminifier.ts`
- Use `source-map` npm package.
- On error detection: if `release_id` exists and sourcemap file exists, resolve minified positions to original file/line/column.
- Store unminified stack in `Error.stack_unminified` (new column).

### 5.3 Backend — Release Resolution (Robust)
**File:** `backend/src/modules/ingest/ingest.worker.ts`
- On session upsert: read `release` from `sessionMeta`.
- Look up `Release` by `{ project_id, version }`.
- Attach `release_id` to the `Session` row.
- On event insert: if event payload has explicit `release`, use it; otherwise inherit from session.
- This makes release tracking robust even if the extension omits it on some events.

### 5.4 Backend — Stack Unminification
**New file:** `backend/src/modules/errors/stack-unminifier.ts`
- Use `source-map` npm package.
- On error detection: if `release_id` exists and sourcemap file exists, resolve minified positions to original file/line/column.
- Store unminified stack in `Error.stack_unminified` (new column).

### 5.5 Backend — AI Analysis Uses Unminified Stack
**File:** `backend/src/modules/ai-analysis/ai-analysis.worker.ts`
- If `stack_unminified` exists, use it in the LLM prompt instead of raw stack.
- Improves AI summary quality and dedup fingerprint accuracy.

### 5.6 Backend — Deduplication Uses Unminified Stack
**File:** `backend/src/modules/errors/error-detection.worker.ts`
- If `stack_unminified` exists, use it for fingerprint computation instead of raw stack.
- Prevents "same bug, different build" dedup misses.

### 5.7 Upload Global Size Limit
**File:** `backend/src/main.ts` or upload module
- Set global multipart body size limit to **20MB**.
- Covers sourcemaps (10MB), screenshots (2MB), replay segments (500KB) with headroom.

### 5.7 Dashboard — Release Management
**New page or modal:** `dashboard/src/pages/ReleasesPage.tsx`
- List releases per project.
- Upload sourcemap for a release.
- Show which errors are tied to which release.
- Filter bugs by release version.

---

## Workstream 6: Screenshot Capture (Opt-In, Best-Effort)

**Goal:** Capture screenshot on error. Only when `screenshot_on_error=true` for the environment.

### 6.1 Extension
**File:** `extension/src/background/service-worker.ts`
- On error event, check `config.screenshotOnError`.
- If enabled: `chrome.tabs.captureVisibleTab()`.
- Compress/resize (max 800px, JPEG 0.7).
- **Direct upload** to `POST /api/v1/upload/screenshot` via `X-API-Key` + multipart/form-data.
- Best-effort: silently drop on failure. Never block error pipeline.

### 6.2 Backend
**New file:** `backend/src/modules/upload/upload.controller.ts`
- `POST /api/v1/upload/screenshot` — API-key guarded, multipart.
- Save to `uploads/screenshots/{projectId}/{sessionId}/{ts}.jpg`.
- **Hard limit:** reject files > 2MB. Return `413` if exceeded.
- Link to latest error in session → update `Bug.screenshot_url`.
- Serve via `@nestjs/serve-static`.

### 6.3 Dashboard
**File:** `dashboard/src/pages/BugDetailPage.tsx`
- Show screenshot if present. "Not available" placeholder if missing.

---

## Workstream 7: Session Replay (rrweb) — Opt-In, Bounded

**Goal:** Record DOM around errors. Only when `replay_enabled=true`. 30s rolling window.

### 7.1 Schema
**File:** `backend/prisma/schema.prisma`
```prisma
model ReplaySegment {
  id         String   @id @default(uuid()) @db.Uuid
  session_id String   @db.Uuid
  project_id String   @db.Uuid
  sequence   Int
  events     Json
  created_at DateTime @default(now()) @db.Timestamptz

  session Session @relation(fields: [session_id], references: [id], onDelete: Cascade)
  project Project @relation(fields: [project_id], references: [id], onDelete: Cascade)

  @@index([session_id, sequence])
}
```

### 7.2 Extension
**New file:** `extension/src/content/replay-tracker.ts`
- Only init if `config.replayEnabled`.
- `record({ maskAllInputs: true, maskTextSelector: '*[data-bi-mask]' })`.
- Rolling 30s buffer in memory.
- On error: flush buffer + record 5s more, then upload directly.
- On healthy navigation: discard buffer.

### 7.3 Backend
**File:** `backend/src/modules/sessions/sessions.controller.ts`
- `POST /api/v1/sessions/:sessionId/replay` — store `ReplaySegment`.
- **Hard limit:** reject segments > 500KB. Return `413` if exceeded.
- Extension must split large replay flushes into multiple segments.
- `GET /api/v1/projects/:projectId/sessions/:sessionId/replay` — ordered segments.

### 7.4 Dashboard
**File:** `dashboard/src/pages/BugDetailPage.tsx`
- "View Replay" button. Fetch segments, render `rrweb-player` in modal.

---

## Workstream 8: Notification Channels (Provider Pattern)

**Goal:** Slack + email notifications. Same provider/registry pattern as integrations.

### 8.1 Provider Interface + Implementations
**New files:**
- `backend/src/modules/notifications/providers/notification.interface.ts`
- `backend/src/modules/notifications/providers/slack.provider.ts`
- `backend/src/modules/notifications/providers/email.provider.ts`
- `backend/src/modules/notifications/providers/notification.registry.ts`

### 8.2 Schema
**File:** `backend/prisma/schema.prisma`
```prisma
model NotificationChannel {
  id          String   @id @default(uuid()) @db.Uuid
  project_id  String   @db.Uuid
  provider_id String   // 'slack' | 'email'
  name        String
  config      Json
  is_active   Boolean  @default(true)
  created_at  DateTime @default(now()) @db.Timestamptz

  project Project            @relation(fields: [project_id], references: [id], onDelete: Cascade)
  logs    NotificationLog[]

  @@index([project_id, is_active])
}

model NotificationLog {
  id         String   @id @default(uuid()) @db.Uuid
  channel_id String   @db.Uuid
  bug_id     String   @db.Uuid
  status     String   // 'sent' | 'failed'
  response   Json?
  created_at DateTime @default(now()) @db.Timestamptz

  channel NotificationChannel @relation(fields: [channel_id], references: [id], onDelete: Cascade)
  bug     Bug                 @relation(fields: [bug_id], references: [id], onDelete: Cascade)
}
```

### 8.3 Backend
**New files:**
- `backend/src/modules/notifications/notification.service.ts` — `sendToProject(projectId, bug)`
- `backend/src/modules/notifications/notifications.controller.ts` — CRUD + test
- `backend/src/modules/notifications/notifications.module.ts`

**File:** `backend/src/modules/rules/rule-evaluation.worker.ts`
- `notify` action → call `notificationService.sendToProject()` (fire-and-forget).

### 8.4 Dashboard
**New file:** `dashboard/src/pages/SettingsPage.tsx`
- Add/remove/test Slack and email channels.
- View recent notification logs.

---

## Workstream 9: Production Resilience + Health Visibility

### 9.1 PII Sanitization Pipeline (Extension + Backend)
**Goal:** Scrub sensitive data before storage, AI prompts, and replay.

**New file:** `extension/src/shared/sanitize.ts`
- Patterns: emails, tokens, passwords, auth headers, cookies, credit cards, SSNs.
- Replace matches with `[REDACTED]`.
- Apply to event payloads and console logs before sending.

**New file:** `backend/src/modules/ingest/sanitization.service.ts`
- **Same patterns, server-side pass.**
- Run on every event before DB insert.
- Run on AI prompt context before LLM call.
- Run on replay segments before storage.
- Run on screenshot metadata before storage.
- **Defense in depth:** even if extension sanitization is bypassed, backend catches it.

### 9.2 Idempotency Keys for Dispatch
**Goal:** Prevent duplicate tickets on retries.

**File:** `backend/prisma/schema.prisma`
```prisma
model IntegrationDelivery {
  // ... existing fields ...
  dispatch_key String? @unique
}
```

**File:** `backend/src/modules/integrations/dispatch.worker.ts`
- `dispatch_key = SHA256(bugId + integrationId)`.
- Before creating ticket, check if `dispatch_key` exists with `status = 'success'`.
- If yes, skip (idempotent).

### 9.3 DLQ Inspector + Health Dashboard
**Goal:** View failed jobs and operational health.

**New endpoint:** `GET /api/v1/system/health`
- Returns:
  ```json
  {
    "queues": {
      "ingest": { "lag": 12, "active": 3 },
      "ai-analysis": { "lag": 45, "active": 2 },
      "dispatch": { "lag": 0, "active": 1, "failed_last_hour": 2 }
    },
    "providers": {
      "jira": { "errors_last_hour": 0, "status": "healthy" },
      "github": { "errors_last_hour": 3, "status": "degraded" }
    },
    "uploads": {
      "screenshot_failures_last_hour": 1,
      "replay_failures_last_hour": 0
    }
  }
  ```
- Read from Redis queue metadata, `IntegrationDelivery` counts, upload logs.

**New endpoint:** `GET /api/v1/projects/:projectId/dlq`
- List failed dispatch jobs from `dispatch-dlq`.
- Payload + error + retry count.

**New endpoint:** `POST /api/v1/projects/:projectId/dlq/:jobId/retry`
- Move job back to dispatch queue.

**Dashboard:** Add `SystemHealthPage` or section in Settings.
- Queue lag cards.
- Provider error rate badges.
- DLQ table with retry buttons.
- Upload failure counters.

### 9.4 AI Confidence Score
**Goal:** Prevent low-confidence AI summaries from auto-dispatching.

**File:** `backend/prisma/schema.prisma`
```prisma
model Bug {
  // ... existing fields ...
  ai_confidence Float?
}
```

**File:** `backend/src/modules/ai-analysis/ai-analysis.worker.ts`
- Add `confidence` to LLM output contract.
- If confidence < 0.6: set `status = 'open'`, skip auto-dispatch even if rules match.

**Dashboard:** Confidence badge on BugDetailPage. "Needs Review" filter on BugsPage.

---

## Workstream 10: Dashboard UX Improvements

### 10.1 Project Navigation
**New file:** `dashboard/src/components/ProjectNav.tsx`
- Sidebar nav: Sessions, Bugs, Rules, Integrations, Settings, System Health.

### 10.2 Cluster-Centric View (Stretch)
**New file:** `dashboard/src/pages/ClustersPage.tsx`
- Show error clusters instead of individual bugs.
- Click cluster → see underlying bugs/events/sessions.
- Display occurrence count, unique users, trend.

### 10.3 Session Timeline View (Stretch)
**File:** `dashboard/src/pages/BugDetailPage.tsx` or new component
- Visual timeline: click → API call → navigation → console → error → replay marker.

### 10.4 Logout
Add explicit logout button.

---

## Build Order

| Step | Workstream | Why first? |
|---|---|---|
| 1 | Environments + SDK Config (4) | Unlocks all extension work; config versioning prevents stale state |
| 2 | Per-event sampling (4.3) | Cost control before volume |
| 3 | PII Sanitization (9.1) | Must be in place before real traffic; defense in depth |
| 4 | Release Tracking + Sourcemaps (5) | Highest product value; improves AI, dedup, trust |
| 5 | Integrations API + Providers (1–2) | External value immediately |
| 6 | Nested Rules + API + UI (3) | Automation value |
| 7 | Idempotency + DLQ + Health (9.2–9.3) | Production safety before scale |
| 8 | AI Confidence (9.4) | Prevents bad auto-dispatch |
| 9 | Screenshot (6) | Visual context |
| 10 | Replay (7) | Visual context |
| 11 | Notifications (8) | Close the loop |
| 12 | Dashboard Nav + UX (10) | Polish |
| 13 | Cluster View + Timeline (10.2–10.3) | Stretch if time permits |

---

## New Dependencies

| Package | Where | Purpose |
|---|---|---|
| `rrweb` | extension | DOM recording |
| `rrweb-player` | dashboard | Replay playback |
| `nodemailer` | backend | Email notifications |
| `@types/nodemailer` | backend | Types |
| `multer` | backend | File uploads |
| `@types/multer` | backend | Types |
| `@nestjs/serve-static` | backend | Serve screenshots/sourcemaps |
| `source-map` | backend | Stack unminification |

---

## Schema Migration Summary

### Added models
- `ProjectEnvironment`
- `Release`
- `ReplaySegment`
- `NotificationChannel`
- `NotificationLog`

### Modified models
- `Project` — remove `replay_enabled`, `screenshot_on_error` (moved to env)
- `Session` — add `environment_id`
- `Error` — add `release_id`, `stack_unminified`
- `Bug` — add `ai_confidence`
- `IntegrationDelivery` — add `dispatch_key` (unique)

---

## Deferred Items

| Feature | Tier | Why deferred |
|---|---|---|
| Circuit Breakers | Phase 2.5 | Important but can be added after core without breaking changes |
| AI Debug Chat | Phase 3 | WebSocket/SSE, chat history, prompt design — too complex |
| Semantic Duplicate Detection | Phase 3 | Embedding-based dedup at ingest — needs careful design |
| Regression Detection | Phase 3 | Historical analysis, reopen logic — valuable but complex |
| Queue Observability (Prometheus/Grafana) | Phase 3 | Infrastructure, health dashboard is enough for now |
| Cold Storage / S3 Archive | Phase 3 | Volume problem, not urgent |
| Partitioned Event Tables | Phase 3 | DB ops, premature |
| Async Embedding Queue | Phase 3 | Performance optimization, not urgent |
| Full Visual Rule Editor | Phase 3 | Overkill for current rule complexity |
| Multi-tenant RBAC | Phase 3 | Not needed yet |