import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { TenantContext } from './tenant-context';

export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.tenantContext as TenantContext | undefined;
  },
);
