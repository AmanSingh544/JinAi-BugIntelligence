-- Migration: Add Tenant infrastructure
-- This migration creates tenants for existing users and links their projects

-- 1. Create Tenant table
CREATE TABLE IF NOT EXISTS "Tenant" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Create TenantMember table
CREATE TABLE IF NOT EXISTS "TenantMember" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS "TenantMember_user_id_idx" ON "TenantMember"(user_id);

-- 3. Create AuditLog table
CREATE TABLE IF NOT EXISTS "AuditLog" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "AuditLog_tenant_created_idx" ON "AuditLog"(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS "AuditLog_actor_created_idx" ON "AuditLog"(actor_id, created_at DESC);

-- 4. Add tenant_id to Project
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS tenant_id UUID;

-- 5. Migrate existing data: create one tenant per user
INSERT INTO "Tenant" (id, name)
SELECT gen_random_uuid(), email || '''s workspace'
FROM "User";

-- 6. Create TenantMember records for existing users
INSERT INTO "TenantMember" (tenant_id, user_id, role)
SELECT t.id, u.id, 'owner'
FROM "User" u
JOIN "Tenant" t ON t.name = u.email || '''s workspace';

-- 7. Link existing projects to their owner's tenant
UPDATE "Project" p
SET tenant_id = tm.tenant_id
FROM "TenantMember" tm
WHERE tm.user_id = p.user_id;

-- 8. Make tenant_id NOT NULL after migration
ALTER TABLE "Project" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "Project" ADD CONSTRAINT "Project_tenant_id_fkey" 
  FOREIGN KEY (tenant_id) REFERENCES "Tenant"(id) ON DELETE CASCADE;

-- 9. Drop old user_id column from Project
ALTER TABLE "Project" DROP COLUMN IF EXISTS user_id;

-- 10. Add regression fields to Bug (if not already added by Prisma migrate)
ALTER TABLE "Bug" ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES "User"(id) ON DELETE SET NULL;
-- ALTER TABLE "Bug" ADD COLUMN IF NOT EXISTS regression_release_id UUID REFERENCES "Release"(id) ON DELETE SET NULL;
