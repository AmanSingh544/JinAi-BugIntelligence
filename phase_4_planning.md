# Phase 4 — Multi-Tenant RBAC + Authorization Layer

> **Status:** Planning  
> **Goal:** Establish tenant isolation, role-based access control, and audit logging as the security foundation for the platform.

---

## Why This Phase Now

The platform has crossed from "bug ingestion tool" to "operational platform":
- Semantic duplicate detection across clusters
- Regression tracking across releases
- AI-powered debug chat with full context
- Ownership, assignment, and intelligent alerting
- Prometheus/Grafana observability

**The biggest remaining risk is not missing features — it's cross-tenant data leakage and unsafe permissions.**

Without tenant isolation:
- Any authenticated user can potentially access another tenant's bugs, sessions, stack traces
- Assignment APIs are unsafe
- AI debug chat may leak sensitive context across tenants
- Notification routing may expose internal metadata
- Future integrations (Jira, GitHub, Slack) become dangerous

RBAC is a **customer trust and compliance prerequisite**, not a nice-to-have.

---

## Architecture: Three Security Layers

### Layer 1: Tenant Isolation (MOST IMPORTANT)

Every query must be tenant-scoped. The tenant is the real security boundary.

**Schema addition:**
```prisma
model Tenant {
  id         String   @id @default(uuid()) @db.Uuid
  name       String
  created_at DateTime @default(now()) @db.Timestamptz

  projects  Project[]
  members   TenantMember[]
  audit_logs AuditLog[]
}

model TenantMember {
  id         String   @id @default(uuid()) @db.Uuid
  tenant_id  String   @db.Uuid
  user_id    String   @db.Uuid
  role       String   // 'owner' | 'admin' | 'developer' | 'viewer'
  created_at DateTime @default(now()) @db.Timestamptz

  tenant Tenant @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  user   User   @relation(fields: [user_id], references: [id], onDelete: Cascade)

  @@unique([tenant_id, user_id])
  @@index([user_id])
}
```

**Project becomes tenant-scoped:**
```prisma
model Project {
  id                    String   @id @default(uuid()) @db.Uuid
  tenant_id             String   @db.Uuid
  name                  String
  ...

  tenant Tenant @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  // user_id removed — ownership is now via TenantMember
}
```

**JWT payload stays minimal:**
```json
{ "sub": "user-uuid", "email": "user@example.com" }
```

**Per-request tenant resolution:**
1. Extract `projectId` from route params
2. Resolve `project.tenant_id`
3. Verify `TenantMember.exists({ tenant_id, user_id, role })`
4. Inject `{ tenantId, role }` into request context
5. All downstream queries use `tenantId` from context

**Why not put tenantId in JWT?** Because users can belong to multiple tenants. The tenant is determined by the resource being accessed, not the session.

---

### Layer 2: Role-Based Permissions

| Role | Permissions |
|------|-------------|
| **OWNER** | Full tenant control: manage members, projects, settings, billing |
| **ADMIN** | Manage users/projects/settings, cannot delete tenant |
| **DEVELOPER** | View/assign/resolve bugs, create integrations, manage rules |
| **VIEWER** | Read-only access to bugs, sessions, dashboards |

**Centralized authorization service:**
```typescript
@Injectable()
export class AuthorizationService {
  async canViewProject(userId: string, projectId: string): Promise<boolean>
  async canManageProject(userId: string, projectId: string): Promise<boolean>
  async canViewBug(userId: string, bugId: string): Promise<boolean>
  async canAssignBug(userId: string, bugId: string): Promise<boolean>
  async canManageTenant(userId: string, tenantId: string): Promise<boolean>
  async canManageMembers(userId: string, tenantId: string): Promise<boolean>
  async canAccessAiChat(userId: string, bugId: string): Promise<boolean>
}
```

**Permission hierarchy:**
- `OWNER` → all permissions
- `ADMIN` → all except tenant deletion, billing changes
- `DEVELOPER` → view + create + update (bugs, integrations, rules), no member management
- `VIEWER` → view only

**Decorators:**
```typescript
@RequireRole('admin')      // Minimum role: admin
@RequirePermission('assign') // Specific capability check
```

---

### Layer 3: Resource Authorization

Per-resource capability checks, not role string comparisons.

Bad:
```typescript
if (user.role === 'ADMIN') { ... }
```

Good:
```typescript
if (await this.authz.canAssignBug(userId, bugId)) { ... }
```

This abstraction is critical because:
- Roles may evolve (add `SRE`, `SECURITY`, etc.)
- Capabilities may be granted outside roles (feature flags)
- Testing is easier against capabilities than role strings

---

## Schema Migration Plan

### Step 1: Create Tenant infrastructure

```prisma
model Tenant {
  id         String   @id @default(uuid()) @db.Uuid
  name       String
  created_at DateTime @default(now()) @db.Timestamptz

  projects   Project[]
  members    TenantMember[]
  audit_logs AuditLog[]
}

model TenantMember {
  id         String   @id @default(uuid()) @db.Uuid
  tenant_id  String   @db.Uuid
  user_id    String   @db.Uuid
  role       String   @default("owner")
  created_at DateTime @default(now()) @db.Timestamptz

  tenant Tenant @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  user   User   @relation(fields: [user_id], references: [id], onDelete: Cascade)

  @@unique([tenant_id, user_id])
  @@index([user_id])
}
```

### Step 2: Migrate Project

```prisma
model Project {
  id                    String   @id @default(uuid()) @db.Uuid
  tenant_id             String   @db.Uuid
  name                  String
  ...
  // user_id REMOVED — replaced by tenant membership

  tenant Tenant @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
}
```

### Step 3: Data migration strategy

For existing data (single-user projects):
1. Create one `Tenant` per existing `User`
2. Create `TenantMember` with `role = 'owner'` linking user to their tenant
3. Set `Project.tenant_id` to the user's tenant
4. Remove `Project.user_id`

This is a breaking schema change requiring a migration script.

### Step 4: Audit log table

```prisma
model AuditLog {
  id         String   @id @default(uuid()) @db.Uuid
  tenant_id  String   @db.Uuid
  actor_id   String   @db.Uuid
  action     String   // 'bug_assigned', 'bug_resolved', 'member_added', 'integration_created', etc.
  entity_type String  // 'bug', 'project', 'member', 'integration'
  entity_id  String?  @db.Uuid
  metadata   Json?
  created_at DateTime @default(now()) @db.Timestamptz

  tenant Tenant @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  actor  User   @relation(fields: [actor_id], references: [id], onDelete: Cascade)

  @@index([tenant_id, created_at(sort: Desc)])
  @@index([actor_id, created_at(sort: Desc)])
}
```

---

## Files to Create

### Backend

1. `backend/src/modules/tenants/tenants.module.ts`
2. `backend/src/modules/tenants/tenants.service.ts` — tenant CRUD, member management
3. `backend/src/modules/tenants/tenants.controller.ts` — create tenant, list members, invite, remove
4. `backend/src/modules/tenants/dto/create-tenant.dto.ts`
5. `backend/src/modules/tenants/dto/invite-member.dto.ts`
6. `backend/src/modules/auth/authorization.service.ts` — centralized permission checks
7. `backend/src/modules/auth/tenant-auth.guard.ts` — validates user belongs to project's tenant
8. `backend/src/modules/auth/roles.decorator.ts` — `@RequireRole('admin')`
9. `backend/src/modules/auth/roles.guard.ts` — enforces role decorator
10. `backend/src/modules/audit/audit.module.ts`
11. `backend/src/modules/audit/audit.service.ts` — writes audit events
12. `backend/src/modules/audit/audit.controller.ts` — GET /audit-logs

### Files to Modify (every controller)

All controllers that accept `projectId` must be updated:
- Apply `TenantAuthGuard` (or update existing `JwtAuthGuard`)
- Inject `AuthorizationService`
- Add permission checks on write operations

Controllers to update:
- `bugs.controller.ts` — tenant-scoped queries, assign permission
- `sessions.controller.ts` — tenant-scoped queries
- `events.controller.ts` — tenant-scoped queries
- `errors.controller.ts` — tenant-scoped queries
- `integrations.controller.ts` — manage permission for create/update/delete
- `rules.controller.ts` — manage permission
- `environments.controller.ts` — manage permission
- `releases.controller.ts` — manage permission
- `upload.controller.ts` — tenant-scoped uploads
- `notifications.controller.ts` — tenant-scoped notifications
- `system.controller.ts` — admin-only endpoints
- `chat.controller.ts` — access permission for AI debug chat
- `dashboard.controller.ts` — tenant-scoped dashboards

---

## Implementation Order

### Phase 4.0 — Tenant Infrastructure + Isolation (P0)

1. Create `Tenant`, `TenantMember`, `AuditLog` schema
2. Migrate `Project` to use `tenant_id` instead of `user_id`
3. Create migration script for existing data
4. Create `TenantsService` + `TenantsController`
5. Update `AuthService` to create a default tenant on user registration
6. Create `TenantAuthGuard` that validates membership on every project-scoped request
7. Update ALL controllers to use `TenantAuthGuard` and tenant-scoped queries

### Phase 4.1 — RBAC + Authorization Service (P1)

1. Create `AuthorizationService` with capability checks
2. Create `@RequireRole()` decorator + `RolesGuard`
3. Apply role checks to sensitive endpoints:
   - Member management → ADMIN+
   - Integration create/delete → DEVELOPER+
   - Bug assignment → DEVELOPER+
   - Bug resolution → DEVELOPER+
   - Settings changes → ADMIN+
4. Update dashboard to show/hide UI based on role

### Phase 4.2 — Audit Logging (P2)

1. Create `AuditService` — lightweight wrapper around `AuditLog` writes
2. Instrument key actions:
   - Bug status changes (resolved, assigned, ignored)
   - Member invitations / role changes
   - Integration create/update/delete
   - Regression detection events
   - Rule changes
3. Add `GET /audit-logs` endpoint (tenant-scoped, ADMIN+)
4. Add "Activity Feed" section to dashboard

---

## Testing Strategy

- **Unit tests** for `AuthorizationService` — test each capability matrix
- **Integration tests** for `TenantAuthGuard` — verify cross-tenant access is blocked
- **E2E tests** for full tenant lifecycle: register → create tenant → invite member → member accesses project → cross-tenant access denied
- **Migration test** — run migration script on seed data, verify no orphaned projects

---

## Backward Compatibility

This is a **breaking change** for the data model. The migration script must handle:
1. Existing users → each gets a tenant
2. Existing projects → linked to user's tenant
3. Existing JWTs → still valid (payload unchanged), but tenant resolution happens per-request

No API breaking changes for the dashboard/extension — the same endpoints work, they just enforce tenant boundaries.

---

## Deferred to Post-RBAC

| Feature | Why Deferred |
|---|---|
| Cold Storage / Partitioned Tables | Scale optimization, not safety-critical |
| Advanced Analytics / SLO Reporting | Needs clean tenant boundary first |
| Bulk Actions UX | Needs RBAC to know who can bulk-modify |
| Notification Preferences | Needs per-user settings, not blocking |
| Custom Roles | Overkill for V1 — 4 roles are enough |
| SSO / SAML / SCIM | Enterprise feature, not needed yet |

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Migration complexity | Script + `db push` in dev; proper migration in prod |
| Missing tenant scopes | Code review + automated test for every controller |
| Performance (extra join) | `TenantMember` indexed by `(user_id)`; query is cheap |
| Role confusion | Clear naming; documented permission matrix |

---

## Approval Request

This plan proposes a significant but necessary security foundation.

**Approach:**
1. Schema migration (Tenant + TenantMember + AuditLog)
2. Data migration script (users → tenants)
3. `TenantAuthGuard` for all project-scoped routes
4. `AuthorizationService` for capability checks
5. Role decorators for sensitive endpoints
6. Audit logging on key actions

**Estimated scope:** ~15 new files, ~20 modified files, 1 migration script.

Shall I proceed with Phase 4.0 (Tenant Infrastructure + Isolation)?
