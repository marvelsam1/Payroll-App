import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.module';
import { SessionUser } from '../common/decorators';

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(companyId: string) {
    const departments = await this.prisma.department.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { employees: true, expenses: true } } },
    });
    return departments;
  }

  async create(companyId: string, data: { name: string; budgetCents?: number }, actor: SessionUser) {
    const dept = await this.prisma.department.create({
      data: { companyId, name: data.name, budgetCents: data.budgetCents ?? 0 },
    });
    await this.audit.record({
      actor,
      companyId,
      action: 'department.created',
      entityType: 'Department',
      entityId: dept.id,
      after: { name: dept.name, budgetCents: dept.budgetCents },
    });
    return dept;
  }

  async update(
    companyId: string,
    id: string,
    patch: { name?: string; budgetCents?: number },
    actor: SessionUser,
  ) {
    const existing = await this.prisma.department.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Department not found');
    const updated = await this.prisma.department.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.budgetCents !== undefined ? { budgetCents: patch.budgetCents } : {}),
      },
    });
    await this.audit.record({
      actor,
      companyId,
      action: 'department.updated',
      entityType: 'Department',
      entityId: id,
      before: { name: existing.name, budgetCents: existing.budgetCents },
      after: { name: updated.name, budgetCents: updated.budgetCents },
    });
    return updated;
  }

  async remove(companyId: string, id: string, actor: SessionUser) {
    const existing = await this.prisma.department.findFirst({
      where: { id, companyId },
      include: { _count: { select: { employees: true } } },
    });
    if (!existing) throw new NotFoundException('Department not found');
    if (existing._count.employees > 0) {
      throw new BadRequestException(
        'Cannot delete a department that still has employees — reassign them first',
      );
    }
    await this.prisma.department.delete({ where: { id } });
    await this.audit.record({
      actor,
      companyId,
      action: 'department.deleted',
      entityType: 'Department',
      entityId: id,
      before: { name: existing.name, budgetCents: existing.budgetCents },
    });
    return { id, deleted: true };
  }
}
