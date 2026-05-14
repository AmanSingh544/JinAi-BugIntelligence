import type { TenantRole } from '@prisma/client';

/**
 * Resolved tenant context attached to every authenticated request
 * that accesses tenant-scoped resources.
 */
export interface TenantContext {
  tenantId: string;
  role: TenantRole;
}
