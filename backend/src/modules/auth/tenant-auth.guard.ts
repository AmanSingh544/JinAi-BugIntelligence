import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AuthorizationService } from './authorization.service';
import type { JwtUser } from '../../shared/decorators/current-user.decorator';

/**
 * Shared tenant resolution guard.
 *
 * For every request with a `:projectId` route parameter:
 * 1. Resolves the project → tenant
 * 2. Verifies the authenticated user is a member of that tenant
 * 3. Attaches { tenantId, role } to the request as `tenantContext`
 *
 * This is the single shared path — no controller should duplicate
 * "load project → verify membership → attach context" logic.
 */
@Injectable()
export class TenantAuthGuard implements CanActivate {
  constructor(private readonly authz: AuthorizationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as JwtUser | undefined;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    const projectId = request.params?.projectId ?? request.params?.id;

    if (projectId) {
      const membership = await this.authz.resolveProjectMembership(user.sub, projectId);
      if (!membership) {
        throw new ForbiddenException('You do not have access to this project');
      }
      request.tenantContext = membership;
      return true;
    }

    // For routes without a projectId, we can't auto-resolve tenant.
    // Controllers handling such routes should use resolveTenantMembership directly.
    return true;
  }
}
