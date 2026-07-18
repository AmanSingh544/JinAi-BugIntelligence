# Master Execution Plan — Bug Intelligence Platform

> **Status:** Substantially complete (verified against code 2026-07-18)  
> **Started:** 2026-05-15  
> **Approach:** Execute in strict priority order. Track progress in this file.
>
> **Note:** The Autonomous Bug-Fix Agent (see `AUTOFIX_ARCHITECTURE.md`) was added after this
> plan was written and is implemented through its Phase 3 (fix generation → PR → webhook/poll
> merge). Its Phase 4 hardening (validation sandbox) is still open.

---

## Build Order (Locked)

| Priority | Phase | Item | Why First? |
|----------|-------|------|------------|
| **P0** | 4.1 | RBAC enforcement across controllers | Security — blocks production |
| **P0** | 2.5.1 | Idempotency distributed lock | Data integrity — duplicate tickets |
| **P1** | 5.1 | Pagination | Scale — currently loads full lists |
| **P1** | 5.2 | Dashboard analytics / charts | Product value — visibility |
| **P1** | 4.2 | Audit logging wiring | Compliance — enterprise need |
| **P2** | 3.1 | Regression detection | Product value — completes AI loop |
| **P2** | 5.3 | Real-time updates | UX — polling is clunky |
| **P2** | 2.5.2 | Fingerprint stability metrics | Operational trust |
| **P3** | 5.4 | Test coverage | Quality — zero meaningful tests |
| **P3** | 2.5.3 | DLQ management UI | Operations — currently stubs |
| **P3** | 3.2 | Async embedding queue | Performance |
| **P4** | 5.5–5.7 | Search, profiles, bulk ops, onboarding | Polish |
| **P5** | 3.3 | Cold storage / partitioning | Scale — when volume demands |

---

## P0: RBAC Enforcement Across All Controllers

### Goal
Ensure every controller that accepts `projectId` properly enforces tenant isolation and role-based permissions. No endpoint should allow cross-tenant access or unauthorized mutations.

### Current State
- `TenantAuthGuard` exists
- `AuthorizationService` exists with capability checks
- `@RequireRole` decorator + `RolesGuard` exist
- Tenant member management exists
- BUT: not all controllers are verified to apply these guards consistently

### Implementation Steps
1. Audit every controller for `TenantAuthGuard` / `ApiKeyOrJwtGuard` + tenant scoping
2. Add `@RequireRole()` to sensitive mutations
3. Verify `AuthorizationService` checks on write operations
4. Add missing permission checks where needed
5. Test cross-tenant access is blocked

### Files to Touch
- `backend/src/modules/bugs/bugs.controller.ts`
- `backend/src/modules/sessions/sessions.controller.ts`
- `backend/src/modules/integrations/integrations.controller.ts`
- `backend/src/modules/rules/rules.controller.ts`
- `backend/src/modules/environments/environments.controller.ts`
- `backend/src/modules/releases/releases.controller.ts`
- `backend/src/modules/notifications/notifications.controller.ts`
- `backend/src/modules/system/system.controller.ts`
- `backend/src/modules/bugs/chat.controller.ts`
- `backend/src/modules/auth/authorization.service.ts` (if gaps found)

---

## P0: Idempotency Distributed Lock for Dispatch

### Goal
Prevent race-condition duplicate tickets when two dispatch workers process the same bug+integration simultaneously.

### Current State
- `dispatch_key` unique field exists on `IntegrationDelivery`
- Worker checks for existing success before dispatching
- BUT: race condition — two concurrent workers can both pass the check

### Implementation Steps
1. Add Redis distributed lock (`SET NX EX`) around dispatch attempt, keyed by `dispatch_key`
2. Ensure lock is released even if provider throws (try/finally or lock auto-TTL)
3. Add DB-level partial unique index on `(bug_id, integration_id)` where `status = 'success'`
4. Update `DispatchWorker` to acquire lock before idempotency check

### Files to Touch
- `backend/src/modules/integrations/dispatch.worker.ts`
- `backend/prisma/schema.prisma` (add partial unique index)
- Backend migration

---

## P1: Pagination (Backend + Dashboard)

### Goal
Add cursor-based or offset pagination to all list endpoints.

### Endpoints Needing Pagination
- `GET /projects/:projectId/bugs`
- `GET /projects/:projectId/sessions`
- `GET /projects/:projectId/releases`
- `GET /notifications`
- `GET /audit-logs` (after Phase 4.2)

### Files to Touch
- Backend controllers (add `skip`/`take` or `cursor` params)
- Backend services (add pagination to Prisma queries)
- Dashboard pages (add pagination UI components)

---

## P1: Dashboard Analytics / Charts

### Goal
New Overview home page with KPIs and trend charts.

### Charts Needed
- Error volume over time (last 7/30 days)
- Bug severity distribution
- Top clusters by occurrence
- Active integrations status
- Recent regressions

### Files to Touch
- `backend/src/modules/dashboard/` (currently empty — needs aggregation endpoints)
- `dashboard/src/pages/OverviewPage.tsx` (new)
- `dashboard/src/App.tsx` (add route)

---

## P1: Audit Logging Wiring

### Goal
Instrument key actions with audit events.

### Actions to Log
- Bug status changes (resolved, assigned, ignored)
- Member invitations / role changes
- Integration create/update/delete
- Regression detection events
- Rule changes

### Files to Touch
- `backend/src/modules/audit/audit.service.ts`
- All controllers with mutations (via decorator or service calls)
- `backend/src/modules/audit/audit.controller.ts` (list endpoint)
- Dashboard: new Activity Feed page

---

*[Phases P2–P5 will be planned in detail when preceding phases are complete]*

---

## Progress Tracker

| Phase | Item | Status | Started | Completed | Notes |
|-------|------|--------|---------|-----------|-------|
| P0 | RBAC Enforcement | ✅ Done | 2026-05-15 | 2026-05-20 | Guards on all controllers incl. DLQ (`projects/:projectId/dlq`) and replay |
| P0 | Idempotency Lock | ✅ Done | 2026-05-15 | 2026-05-20 | Redis `acquireLock`/`releaseLock` in `dispatch.worker.ts` |
| P1 | Pagination | ✅ Done | 2026-05-17 | 2026-05-20 | Shared `pagination.dto` + dashboard `Pagination` component |
| P1 | Analytics/Charts | ✅ Done | 2026-05-17 | 2026-05-20 | `dashboard` module + `OverviewPage` |
| P1 | Audit Wiring | ✅ Done | 2026-05-17 | 2026-05-20 | `AuditService` in bugs/rules/integrations/tenants/environments + `ActivityFeedPage` |
| P2 | Regression Detection | ✅ Done | 2026-05-17 | 2026-05-20 | In `ai-analysis.worker.ts` + dashboard filter |
| P2 | Real-Time Updates | ✅ Done | 2026-05-18 | 2026-05-20 | SSE (`events` module + `useEventSource` hook) |
| P2 | Fingerprint Metrics | 🔲 Not started | — | — | No fingerprint-stability / duplicate-bug-rate metrics in code |
| P3 | Test Coverage | 🟡 Partial | 2026-05-18 | — | 21 backend spec files + 4 dashboard tests; still thin for codebase size |
| P3 | DLQ Management UI | ✅ Done | 2026-05-18 | 2026-05-20 | Real guarded list/retry endpoints |
| P3 | Async Embedding Queue | ✅ Done | 2026-05-18 | 2026-05-20 | Standalone `embedding.worker.ts` |
| P4 | Search, Profiles, Bulk Ops | ✅ Done | 2026-05-18 | 2026-05-20 | Bug search, bulk-status, forgot/reset password, email verify, onboarding |
| P5 | Cold Storage | 🟡 Partial | — | — | Soft archive (`archived_at` + archive worker) only; no partitioning/S3 (deferred until volume demands) |
