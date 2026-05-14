Here's the consolidated **phase-wise plan with effort estimates**, mapping what was originally planned against what's actually done, and what's left.

---

## 📋 EXECUTIVE SUMMARY

| Phase | Original Goal | Status | Remaining Work | Est. Effort |
|-------|--------------|--------|----------------|-------------|
| **Phase 2** | Core production features (integrations, rules, replay, screenshots, notifications, releases, sourcemaps) | ~**90% Done** | Jira/GitHub hardening, Cluster-centric view, Session timeline, Input tracking | **6–8 days** |
| **Phase 2.5** | Operational maturity (retention, retry discipline, idempotency, pipeline validation) | ~**85% Done** | Idempotency distributed lock, Fingerprint stability metrics, DLQ management UI | **4–5 days** |
| **Phase 3** | Advanced AI & observability (semantic dupes, AI chat, Prometheus/Grafana, regression) | ~**70% Done** | Regression detection, Async embedding queue, Cold storage / partitioning | **8–10 days** |
| **Phase 4** | Multi-tenant RBAC + Audit | ~**60% Done** | Full RBAC enforcement across all controllers, Audit wiring, Dashboard role-based UI | **6–8 days** |
| **Phase 5** | Scale & polish (not previously planned) | **Not started** | Pagination, Real-time (WebSocket/SSE), Charts/KPIs, Test coverage, Onboarding | **12–15 days** |

**Total remaining effort: ~36–46 days** (roughly **7–9 weeks** at 50% allocation, or **5–6 weeks** full-time)

---

## 🔷 PHASE 2 — CORE PRODUCTION FEATURES *(Original: ~60 files, mostly complete)*

### ✅ Already Delivered
- Real integration providers (Jira, GitHub, Meridian, Generic HTTP)
- Integration management API + dashboard UI
- Nested rule engine (`any`/`all`) + RulesPage
- Project environments + SDK config + per-event sampling
- Release tracking + sourcemap upload (single + ZIP batch) + stack unminification
- Screenshot capture (opt-in, best-effort)
- Session replay (rrweb) — extension recording + dashboard playback
- Notification channels (Slack, Email, Teams) + in-app notifications
- PII sanitization (extension `maskSensitiveFields` + backend)
- AI confidence scoring
- Dashboard navigation + all core pages

### 🔲 Remaining — Phase 2

| # | Item | Scope | Effort |
|---|------|-------|--------|
| 2.1 | **Jira/GitHub Provider Hardening** | Real-world testing, edge-case handling, better error messages, OAuth app support (currently PAT-only) | 2–3 days |
| 2.2 | **Cluster-Centric Dashboard View** | New `ClustersPage`: browse by cluster, see occurrence trends, unique users, drill to bugs | 2 days |
| 2.3 | **Session Timeline View** | Visual timeline in `BugDetailPage`: clicks → API calls → navigation → console → error marker | 1–2 days |
| 2.4 | **Extension Input/Change Event Tracking** | Wire `INPUT` event type in `dom-tracker.ts` | 0.5 day |
| 2.5 | **Extension `sanitize.ts` Wiring** | Call regex-based redaction in service worker before batch flush | 0.5 day |

**Phase 2 Remaining: ~6–8 days**

---

## 🔷 PHASE 2.5 — OPERATIONAL MATURITY *(In Progress)*

### ✅ Already Delivered
- Retention tier policies (daily cron, per-environment)
- Release-aware fingerprinting (`fingerprintNormalizeStack`)
- AI batching / race-condition fix (Redis distributed locks)
- Retry discipline (`ProviderError`, exponential backoff + jitter, 24h horizon)
- Cluster-first pipeline (embedding → cluster → conditional LLM)
- E2E pipeline validation (synthetic error injection, per-stage latency)
- Notification queueing + retry (BullMQ worker)
- Sourcemap upload robustness (50MB limit, pre-parse validation)

### 🔲 Remaining — Phase 2.5

| # | Item | Scope | Effort |
|---|------|-------|--------|
| 2.5.1 | **Idempotency Hardening (Distributed Lock)** | Redis `SET NX` around dispatch attempt keyed by `dispatch_key`; DB unique index on `(bug_id, integration_id, status='success')` | 1–2 days |
| 2.5.2 | **Fingerprint Stability Metrics** | Track `% errors matching existing fingerprint` and `duplicate_bug_rate`; expose on health endpoint + dashboard | 1–2 days |
| 2.5.3 | **DLQ Management UI** | Backend: real DLQ list/retry endpoints. Dashboard: DLQ table with retry buttons, failed payload viewer | 1–2 days |

**Phase 2.5 Remaining: ~4–5 days**

---

## 🔷 PHASE 3 — ADVANCED AI & OBSERVABILITY *(In Progress)*

### ✅ Already Delivered
- Semantic duplicate detection (`/similar`, `/cluster-members` endpoints + UI)
- AI Debug Chat (per-bug threaded chat with context-aware prompts)
- Prometheus/Grafana observability (`/metrics`, provisioned dashboard, worker instrumentation, HTTP middleware)

### 🔲 Remaining — Phase 3

| # | Item | Scope | Effort |
|---|------|-------|--------|
| 3.1 | **Regression Detection** | When a resolved bug's fingerprint reappears in a newer release, auto-reopen and mark as regression; notify assignee; dashboard "regressions" filter already exists but backend logic needs hardening | 2–3 days |
| 3.2 | **Async Embedding Queue** | Extract embedding generation from AI worker into standalone `EmbeddingWorker`; reduces AI worker latency | 2–3 days |
| 3.3 | **Cold Storage / Partitioned Tables** | Partition `Event` table by time; archive old events to S3/parquet; deferred until high volume, but schema should be ready | 3–4 days |

**Phase 3 Remaining: ~8–10 days**

---

## 🔷 PHASE 4 — MULTI-TENANT RBAC + AUTHORIZATION *(Planning → Partially Implemented)*

### ✅ Already Delivered
- Tenant + TenantMember schema
- Project scoped to tenant
- `TenantAuthGuard` + `AuthorizationService` (capability checks)
- `@RequireRole` decorator + `RolesGuard`
- Tenant member management API (invite, list, remove)
- Auto-create tenant on user registration
- Audit module + `AuditService`

### 🔲 Remaining — Phase 4

| # | Item | Scope | Effort |
|---|------|-------|--------|
| 4.1 | **RBAC Enforcement Across All Controllers** | Verify every controller uses `TenantAuthGuard` + `AuthorizationService`; add missing permission checks on write endpoints (bugs, integrations, rules, releases, environments) | 2–3 days |
| 4.2 | **Audit Logging Wiring** | Add `@AuditLog()` decorator or middleware; instrument key actions: bug status changes, member invites, integration CRUD, rule changes, regression events | 2 days |
| 4.3 | **Dashboard Role-Based UI** | Hide/show actions based on role: VIEWER sees read-only, DEVELOPER can't manage members, ADMIN can't delete tenant | 1–2 days |
| 4.4 | **Audit Log Dashboard Page** | Activity feed: `GET /audit-logs` (tenant-scoped, ADMIN+), filter by actor/action/date | 1 day |

**Phase 4 Remaining: ~6–8 days**

---

## 🔷 PHASE 5 — SCALE, POLISH & TESTING *(New — not in original plans)*

This phase consolidates all the "gap" items I identified that aren't covered by earlier phases.

| # | Item | Scope | Effort |
|---|------|-------|--------|
| 5.1 | **Pagination Everywhere** | Add cursor/pagination to bugs, sessions, releases, notifications, audit logs (backend + dashboard) | 2–3 days |
| 5.2 | **Dashboard Analytics / Charts** | New "Overview" home page with: error volume over time, bug severity distribution, top clusters, active integrations, recent regressions. Needs backend aggregation endpoints. | 3–4 days |
| 5.3 | **Real-Time Updates** | WebSocket or SSE for live bug notifications, bug list auto-refresh, assignment updates | 2–3 days |
| 5.4 | **Test Coverage** | Backend: controller/service integration tests. Dashboard: component tests (Vitest/RTL). Extension: unit tests. E2E: fix existing scaffold. | 3–4 days |
| 5.5 | **Advanced Search** | Full-text search on bug summaries, stack traces, error messages (Postgres `tsvector` or similar) | 1–2 days |
| 5.6 | **User Profile & Onboarding** | Password reset, email verification, first-project onboarding wizard | 1–2 days |
| 5.7 | **Bulk Operations** | Bulk status update, bulk assign, bulk ignore on bugs list | 1 day |

**Phase 5 Remaining: ~12–15 days**

---

## 📅 SUGGESTED BUILD ORDER

If you're planning sprints, here's the recommended priority:

| Priority | Phase | Item | Why First? |
|----------|-------|------|------------|
| **P0** | 4.1 | RBAC enforcement across controllers | **Security — blocks production** |
| **P0** | 2.5.1 | Idempotency distributed lock | **Data integrity — duplicate tickets are bad** |
| **P1** | 5.1 | Pagination | **Scale — currently loads full lists** |
| **P1** | 5.2 | Dashboard analytics / charts | **Product value — users need visibility** |
| **P1** | 4.2 | Audit logging wiring | **Compliance — required for enterprise** |
| **P2** | 3.1 | Regression detection | **Product value — completes AI loop** |
| **P2** | 5.3 | Real-time updates | **UX — polling is clunky at scale** |
| **P2** | 2.5.2 | Fingerprint stability metrics | **Operational trust — prove dedup works** |
| **P3** | 5.4 | Test coverage | **Quality — currently zero meaningful tests** |
| **P3** | 2.5.3 | DLQ management UI | **Operations — currently stubs** |
| **P3** | 3.2 | Async embedding queue | **Performance — optimizes AI worker** |
| **P4** | 5.5–5.7 | Search, profiles, bulk ops, onboarding | **Polish — nice to have** |
| **P5** | 3.3 | Cold storage / partitioning | **Scale — only when volume demands** |

---

## 🎯 REALISTIC MILESTONES

| Milestone | What's Included | Effort | Cumulative |
|-----------|-----------------|--------|------------|
| **Security & Integrity** | RBAC enforcement + idempotency locks + audit wiring | ~10 days | 10 days |
| **Scale-Ready** | Pagination + dashboard analytics + regression detection | ~10 days | 20 days |
| **Production Polish** | Real-time updates + DLQ UI + test coverage + search | ~10 days | 30 days |
| **Advanced Ops** | Async embeddings + cold storage + onboarding | ~8 days | 38 days |

