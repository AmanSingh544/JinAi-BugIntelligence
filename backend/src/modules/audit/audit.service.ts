import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';

export interface AuditEvent {
  tenantId: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(event: AuditEvent) {
    await this.prisma.auditLog.create({
      data: {
        tenant_id: event.tenantId,
        actor_id: event.actorId,
        action: event.action,
        entity_type: event.entityType,
        entity_id: event.entityId,
        metadata: (event.metadata ?? {}) as any
      },
    });
  }

  async findByTenant(tenantId: string, skip = 0, take = 20) {
    return this.prisma.auditLog.findMany({
      where: { tenant_id: tenantId },
      orderBy: { created_at: 'desc' },
      skip,
      take,
      include: {
        actor: { select: { id: true, email: true } },
      },
    });
  }

  async countByTenant(tenantId: string) {
    return this.prisma.auditLog.count({ where: { tenant_id: tenantId } });
  }
}
