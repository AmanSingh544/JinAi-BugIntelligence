# P0: RBAC Enforcement Across All Controllers — Execution Plan

## Audit Findings

| Controller | Guards | Gaps |
|------------|--------|------|
| `ProjectsController` | `JwtAuthGuard` only | No `TenantAuthGuard`. `findOne`/`rotateKey` don't verify project belongs to user's tenant. |
| `RulesController` | `JwtAuthGuard, TenantAuthGuard` | `findOne` doesn't verify rule belongs to project. |
| `IntegrationsController` | `JwtAuthGuard, TenantAuthGuard` | `validate` doesn't verify integration belongs to project. |
| `NotificationsController` | `JwtAuthGuard, TenantAuthGuard` | `update`/`delete`/`test` don't verify channel belongs to project. |
| `SystemController` | `JwtAuthGuard, TenantAuthGuard` | `synthetic-error` uses `body.projectId` without authz check; `findFirst()` fallback is unscoped. |
| `DlqController` | **None** | Completely unprotected. |
| `ReplayController` (GET) | **None** | Anyone can fetch replay segments. |
| `MetricsController` | **None** | Intentionally public for Prometheus, but verify. |

## Implementation Steps

### Step 1: ProjectsController
- Add `TenantAuthGuard` to the controller
- Remove manual `resolveTenantId` helper (TenantAuthGuard handles this)
- Pass `tenantId` from `CurrentTenant()` to service calls if needed

### Step 2: RulesController.findOne
- Change lookup to `where: { id, project_id: projectId }`

### Step 3: IntegrationsController.validate
- Change lookup to `where: { id, project_id: projectId }`

### Step 4: NotificationsController
- Change `update`/`delete`/`test` lookups to `where: { id, project_id: projectId }`

### Step 5: SystemController.synthetic-error
- Add authz check: `canManageProject(userId, body.projectId)` if projectId provided
- Scope `findFirst()` fallback to projects the user can access

### Step 6: DlqController
- Add `JwtAuthGuard, TenantAuthGuard`
- Move under `projects/:projectId/dlq` with proper tenant scoping

### Step 7: ReplayController (GET)
- Add `JwtAuthGuard, TenantAuthGuard` to the GET endpoint
- Verify session belongs to project

### Step 8: MetricsController
- Verify `/metrics` exposure is acceptable (no auth for Prometheus scraping)
- If needed, add env-based toggle or IP-based guard later

## Files to Modify
1. `backend/src/modules/projects/projects.controller.ts`
2. `backend/src/modules/rules/rules.controller.ts`
3. `backend/src/modules/integrations/integrations.controller.ts`
4. `backend/src/modules/notifications/notifications.controller.ts`
5. `backend/src/modules/system/system.controller.ts`
6. `backend/src/modules/sessions/sessions.controller.ts` (ReplayController GET)
7. `backend/src/modules/auth/authorization.service.ts` (if new capabilities needed)

## Verification
- Build passes: `cd backend && npx tsc --noEmit`
- All controllers that accept `projectId` have `TenantAuthGuard`
- All resource lookups by `id` also filter by `project_id`
- Cross-tenant access returns 403
