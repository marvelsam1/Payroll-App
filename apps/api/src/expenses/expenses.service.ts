import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { AuditService } from '../audit/audit.module';
import { SessionUser } from '../common/decorators';
import { ReimbursementMode, Role } from '../generated/client';

export interface SubmitExpenseInput {
  amountCents: number;
  category: string;
  description?: string;
  expenseDate?: string;
  departmentId?: string;
  reimbursementMode?: ReimbursementMode;
  receiptPath?: string | null;
}

/**
 * Expense management: submit (with receipt) → approve/reject → reimbursed
 * via the next payroll run (DEFER_TO_PAYROLL) or a standalone ledger entry.
 * Approved spend counts against the department budget (dashboard).
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async submit(session: SessionUser, input: SubmitExpenseInput) {
    if (!session.companyId) throw new ForbiddenException('No company scope');
    if (input.amountCents <= 0) throw new BadRequestException('amount must be positive');

    let employeeId: string | null = null;
    if (session.role === Role.EMPLOYEE) {
      const employee = await this.prisma.employee.findFirst({
        where: { companyId: session.companyId, userId: session.id },
      });
      employeeId = employee?.id ?? null;
    }

    if (input.departmentId) {
      const dept = await this.prisma.department.findFirst({
        where: { id: input.departmentId, companyId: session.companyId },
      });
      if (!dept) throw new BadRequestException('Unknown department');
    }

    const expense = await this.prisma.expense.create({
      data: {
        companyId: session.companyId,
        submittedById: session.id,
        employeeId,
        departmentId: input.departmentId ?? null,
        amountCents: input.amountCents,
        category: input.category,
        description: input.description ?? '',
        expenseDate: input.expenseDate ? new Date(input.expenseDate) : new Date(),
        reimbursementMode: input.reimbursementMode ?? 'DEFER_TO_PAYROLL',
        receiptPath: input.receiptPath ?? null,
        status: 'SUBMITTED',
      },
      include: { department: { select: { id: true, name: true } } },
    });

    await this.audit.record({
      actor: session,
      action: 'expense.submitted',
      entityType: 'Expense',
      entityId: expense.id,
      after: { amountCents: expense.amountCents, category: expense.category },
    });
    return expense;
  }

  async list(
    session: SessionUser,
    q: {
      status?: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REIMBURSED';
      departmentId?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 20));
    const where: any = {
      ...(session.companyId ? { companyId: session.companyId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.departmentId ? { departmentId: q.departmentId } : {}),
    };
    // Employees only ever see their own expenses
    if (session.role === Role.EMPLOYEE) where.submittedById = session.id;

    const [items, total] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        include: {
          department: { select: { id: true, name: true } },
          submittedBy: { select: { id: true, name: true, email: true } },
          employee: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.expense.count({ where }),
    ]);
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getOne(session: SessionUser, id: string) {
    const expense = await this.prisma.expense.findFirst({
      where: { id, ...(session.companyId ? { companyId: session.companyId } : {}) },
      include: { department: true, submittedBy: { select: { id: true, name: true } } },
    });
    if (!expense) throw new NotFoundException('Expense not found');
    if (session.role === Role.EMPLOYEE && expense.submittedById !== session.id) {
      throw new NotFoundException('Expense not found');
    }
    return expense;
  }

  async getReceipt(session: SessionUser, id: string) {
    const expense = await this.getOne(session, id);
    if (!expense.receiptPath) throw new NotFoundException('No receipt attached');
    return expense.receiptPath;
  }

  async approve(actor: SessionUser, id: string) {
    const expense = await this.getOne(actor, id);
    if (expense.status !== 'SUBMITTED') {
      throw new BadRequestException(`Only SUBMITTED expenses can be approved (${expense.status})`);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const e = await tx.expense.update({
        where: { id },
        data: { status: 'APPROVED', approvedAt: new Date(), approvedById: actor.id },
      });
      // Accrue: Dr department expense category / Cr reimbursement payable
      await this.ledger.postTransaction(
        {
          companyId: expense.companyId,
          description: `Expense approved — ${expense.category}: ${expense.description || 'no description'}`,
          referenceType: 'expense',
          referenceId: expense.id,
          createdBy: actor.id,
          entries: [
            {
              accountCode: 'REIMBURSABLE_EXPENSE',
              debit: expense.amountCents,
              relatedEntityType: 'Expense',
              relatedEntityId: expense.id,
            },
            {
              accountCode: 'EXPENSE_REIMBURSEMENT_PAYABLE',
              credit: expense.amountCents,
              relatedEntityType: 'Expense',
              relatedEntityId: expense.id,
            },
          ],
        },
        tx,
      );
      return e;
    });
    await this.audit.record({
      actor,
      action: 'expense.approved',
      entityType: 'Expense',
      entityId: id,
      before: { status: 'SUBMITTED' },
      after: { status: 'APPROVED', amountCents: expense.amountCents, mode: expense.reimbursementMode },
    });
    return updated;
  }

  async reject(actor: SessionUser, id: string, reason: string) {
    const expense = await this.getOne(actor, id);
    if (expense.status !== 'SUBMITTED') {
      throw new BadRequestException(`Only SUBMITTED expenses can be rejected (${expense.status})`);
    }
    const updated = await this.prisma.expense.update({
      where: { id },
      data: { status: 'REJECTED', rejectionReason: reason },
    });
    await this.audit.record({
      actor,
      action: 'expense.rejected',
      entityType: 'Expense',
      entityId: id,
      before: { status: 'SUBMITTED' },
      after: { status: 'REJECTED', reason },
    });
    return updated;
  }

  /**
   * Standalone reimbursement: immediate balanced ledger entry
   * (Dr payable / Cr operating cash). Deferred expenses are paid by the next
   * payroll run instead — that path marks them REIMBURSED during processing.
   */
  async reimburseStandalone(actor: SessionUser, id: string) {
    const expense = await this.getOne(actor, id);
    if (expense.status !== 'APPROVED') {
      throw new BadRequestException(`Only APPROVED expenses can be reimbursed (${expense.status})`);
    }
    if (expense.reimbursementMode !== 'STANDALONE') {
      throw new BadRequestException(
        'This expense is scheduled for reimbursement via the next payroll run (DEFER_TO_PAYROLL)',
      );
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const e = await tx.expense.update({
        where: { id },
        data: { status: 'REIMBURSED', reimbursedAt: new Date() },
      });
      await this.ledger.postTransaction(
        {
          companyId: expense.companyId,
          description: `Expense reimbursed (standalone) — ${expense.category}`,
          referenceType: 'expense',
          referenceId: expense.id,
          createdBy: actor.id,
          entries: [
            {
              accountCode: 'EXPENSE_REIMBURSEMENT_PAYABLE',
              debit: expense.amountCents,
              relatedEntityType: 'Expense',
              relatedEntityId: expense.id,
            },
            {
              accountCode: 'OPERATING_CASH',
              credit: expense.amountCents,
              relatedEntityType: 'Expense',
              relatedEntityId: expense.id,
            },
          ],
        },
        tx,
      );
      return e;
    });
    await this.audit.record({
      actor,
      action: 'expense.reimbursed',
      entityType: 'Expense',
      entityId: id,
      before: { status: 'APPROVED' },
      after: { status: 'REIMBURSED', mode: 'STANDALONE' },
    });
    return updated;
  }
}
