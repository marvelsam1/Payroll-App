import { Controller, Get, Module, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, RequirePermissions, SessionUser } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';
import { Prisma } from '../generated/client';

/**
 * Activity Log viewer — read-only projection of the append-only AuditLog.
 * Visible to Platform Admin (all tenants) and Company Admin (own tenant)
 * only, per the permission matrix. The AuditLog table has NO update/delete
 * code path anywhere in the application (enforced by DB triggers too).
 */
@Controller('audit')
export class AuditLogController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.auditRead)
  async list(
    @CurrentUser() s: SessionUser,
    @Query()
    q: {
      companyId?: string;
      entityType?: string;
      entityId?: string;
      action?: string;
      actorId?: string;
      from?: string;
      to?: string;
      page?: string;
      pageSize?: string;
    },
  ) {
    const page = Math.max(1, parseInt(q.page ?? '1', 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(q.pageSize ?? '50', 10)));

    const where: Prisma.AuditLogWhereInput = {
      // Tenant roles: strictly own company. Platform admin: optional filter.
      ...(s.companyId ? { companyId: s.companyId } : {}),
      ...(q.companyId && !s.companyId ? { companyId: q.companyId } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.action ? { action: { contains: q.action } } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, name: true, email: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }
}

@Module({
  controllers: [AuditLogController],
})
export class AuditLogModule {}
