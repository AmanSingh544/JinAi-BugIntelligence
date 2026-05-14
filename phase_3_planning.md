# Phase 3 Implementation Plan — Bug Intelligence Platform

> **Status:** In Progress  
> **Started:** 2026-05-11  
> **Goal:** Build advanced observability, AI, and operational features that extend the platform beyond core bug tracking into intelligent incident management.

---

## What has been implemented so far

### ✅ Feature 1: Semantic Duplicate Detection

**Problem:** Developers couldn't easily find bugs that were semantically similar to the one they were investigating. The clustering system existed but wasn't exposed to users.

**Solution:**
- Added `GET /projects/:projectId/bugs/:bugId/similar` endpoint — vector similarity search using pgvector `<=>` operator
- Added `GET /projects/:projectId/bugs/:bugId/cluster-members` endpoint — returns all bugs in the same cluster
- Dashboard `BugDetailPage` now shows:
  - "Similar Bugs" section with distance scores (cosine distance rendered as % similarity)
  - Color-coded similarity badges (green < 15%, amber < 30%, red ≥ 30%)
  - "Cluster members" subsection for bugs in the same cluster
- API client updated with `api.bugs.similar()` and `api.bugs.clusterMembers()`

**Files changed:**
- `backend/src/modules/bugs/bugs.controller.ts` — new endpoints
- `dashboard/src/api.ts` — new types and API methods
- `dashboard/src/pages/BugDetailPage.tsx` — UI sections

---

### ✅ Feature 2: AI Debug Chat

**Problem:** AI analysis produced a one-time summary, but developers often need to dig deeper — ask follow-up questions about root cause, impact, or fix strategies.

**Solution:**
- Added `ChatThread` and `ChatMessage` models to Prisma schema
- Created `ChatService` — LLM-backed conversational debugging assistant
  - Builds rich system prompt from bug context (summary, root cause, stack trace, steps, recent events)
  - Uses existing OpenAI-compatible client with model fallback chain
  - Persists conversation history per bug
- Created `ChatController` with endpoints:
  - `GET /projects/:projectId/bugs/:bugId/chat` — get or create thread
  - `POST /projects/:projectId/bugs/:bugId/chat` — send message, get AI response
- Dashboard `BugDetailPage` now has an "AI Debug Assistant" chat panel:
  - Message history with user/assistant styling
  - Input field with Enter-to-send
  - Loading state ("Thinking…")
  - Auto-scroll to latest message

**Files changed:**
- `backend/prisma/schema.prisma` — `ChatThread`, `ChatMessage` models + relations on `Bug` and `Project`
- `backend/src/modules/bugs/chat.service.ts` — new
- `backend/src/modules/bugs/chat.controller.ts` — new
- `backend/src/modules/bugs/bugs.module.ts` — imports ConfigModule, registers ChatController + ChatService
- `dashboard/src/api.ts` — `ChatThread`, `ChatMessage` types + API methods
- `dashboard/src/pages/BugDetailPage.tsx` — chat UI section

**Schema migration needed:**
```bash
cd backend
npx prisma migrate dev --name add_chat_threads
```

---

## Remaining Phase 3 features (prioritized)

| Priority | Feature | Rationale |
|----------|---------|-----------|
| P0 | **Prometheus/Grafana Observability** | Operational necessity — need metrics, dashboards, and alerting before production scale |
| P1 | **Regression Detection** | High product value — detect when "fixed" bugs reappear in new releases |
| P2 | **Async Embedding Queue** | Performance optimization — extract embedding generation from AI worker |
| P3 | **Cold Storage / Partitioned Tables** | Volume scaling — premature until high event volume |
| P3 | **Multi-tenant RBAC** | Not needed until multiple teams share an instance |

---

## Next up: Prometheus/Grafana Observability

### Goals
1. Expose application metrics via `/metrics` endpoint (Prometheus format)
2. Instrument HTTP requests, worker job durations, queue depths, provider health
3. Add Prometheus + Grafana services to `docker-compose.yml`
4. Provision a starter Grafana dashboard for the Bug Intelligence platform

### Backend changes

**1. Metrics collection**
- Install `prom-client`
- Create `backend/src/modules/metrics/metrics.service.ts` — central registry + metric definitions:
  - `http_requests_total` — Counter with labels: method, route, status
  - `http_request_duration_seconds` — Histogram with same labels
  - `bullmq_jobs_processed_total` — Counter with labels: queue, status
  - `bullmq_job_duration_seconds` — Histogram with labels: queue
  - `bullmq_queue_depth` — Gauge with labels: queue, state
  - `provider_errors_total` — Counter with labels: provider, status_code
  - `provider_cooldown_active` — Gauge with labels: provider
  - `ai_llm_calls_total` — Counter with labels: model, status
  - `ai_llm_duration_seconds` — Histogram with labels: model
  - `db_query_duration_seconds` — Histogram (optional, via Prisma middleware)

**2. HTTP middleware**
- Create `backend/src/shared/metrics/http-metrics.middleware.ts`
- Register as global middleware in `AppModule`
- Records request count + duration for all incoming HTTP requests

**3. Worker instrumentation**
- Instrument each BullMQ worker (ingest, error-detection, ai-analysis, clustering, dispatch, notification):
  - Record job processing count (success/failure)
  - Record job duration
- Add to existing worker `process()` methods (minimal intrusion)

**4. Metrics controller**
- Create `backend/src/modules/metrics/metrics.controller.ts`
- `GET /metrics` — returns Prometheus text format
- No auth guard (Prometheus scrapes directly)

**5. Docker Compose**
- Add `prometheus` service to `docker-compose.yml`
  - Volume mount: `./prometheus.yml:/etc/prometheus/prometheus.yml`
  - Port: `9090:9090`
- Add `grafana` service to `docker-compose.yml`
  - Volume mount: `./grafana/provisioning:/etc/grafana/provisioning`
  - Port: `3001:3000` (avoid conflict with backend)
- Create `prometheus.yml` — scrape config targeting backend at `host.docker.internal:4000`
- Create `grafana/provisioning/dashboards/dashboard.yml` + `grafana/provisioning/datasources/datasource.yml`
- Create starter dashboard JSON in `grafana/dashboards/bug-intelligence.json`

### Files to create
1. `backend/src/modules/metrics/metrics.module.ts`
2. `backend/src/modules/metrics/metrics.service.ts`
3. `backend/src/modules/metrics/metrics.controller.ts`
4. `backend/src/shared/metrics/http-metrics.middleware.ts`
5. `prometheus.yml`
6. `grafana/provisioning/dashboards/dashboard.yml`
7. `grafana/provisioning/datasources/datasource.yml`
8. `grafana/dashboards/bug-intelligence.json`

### Files to modify
1. `backend/package.json` — add `prom-client` dependency
2. `backend/src/app.module.ts` — import MetricsModule, register middleware
3. `docker-compose.yml` — add prometheus + grafana services
4. Each worker file — add metric recording (lightweight, 2-3 lines per worker)

### Testing plan
- `npm run build` passes
- `curl http://localhost:4000/metrics` returns valid Prometheus text
- Prometheus UI at `http://localhost:9090` shows targets up
- Grafana UI at `http://localhost:3001` shows provisioned dashboard
- Dashboard displays: request rate, error rate, queue depths, AI LLM latency, provider error rates

---

## Architecture decisions

1. **prom-client over NestJS micrometer** — `prom-client` is the de-facto standard for Node.js Prometheus metrics. No need for abstraction layers.
2. **Middleware-based HTTP instrumentation** — Global middleware captures all routes without decorating every controller.
3. **Manual worker instrumentation** — BullMQ doesn't expose a clean hooks API for metrics across all workers. Adding 2-3 lines per `process()` method is the simplest approach.
4. **Grafana provisioning via files** — Dashboards and datasources defined as code (JSON/YAML) so they survive container restarts and can be version-controlled.
5. **No authentication on /metrics** — Prometheus scrapes directly. If needed later, add IP allowlist or basic auth via reverse proxy.

---

## Rollout checklist

- [ ] Install `prom-client` and add to package.json
- [ ] Create metrics module, service, controller
- [ ] Create HTTP metrics middleware
- [ ] Register middleware in AppModule
- [ ] Instrument all BullMQ workers
- [ ] Update docker-compose.yml with Prometheus + Grafana
- [ ] Create prometheus.yml scrape config
- [ ] Create Grafana provisioning files
- [ ] Create starter dashboard JSON
- [ ] Run backend typecheck (`npx tsc --noEmit`)
- [ ] Run backend tests (`npm run test`)
- [ ] Run dashboard build (`npm run build`)
- [ ] Verify `/metrics` endpoint returns Prometheus format
