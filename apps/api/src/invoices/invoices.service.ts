import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { AuditService } from '../audit/audit.module';
import { AchService } from '../ach/ach.service';
import { SessionUser } from '../common/decorators';
import { Role } from '../generated/client';

export interface SubmitInvoiceInput {
  amountCents: number;
  description: string;
  periodStart: string;
  periodEnd: string;
}

/**
 * Contractor invoices: submit → approve/reject → batch payment.
 * NO tax withholding — gross = payment (separate module, shared ledger via
 * the Contractor Payable account).
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly ach: AchService,
  ) {}

  private async resolveContractorForUser(session: SessionUser) {
    if (!session.companyId) return null;
    return this.prisma.contractor.findFirst({
      where: { companyId: session.companyId, userId: session.id },
    });
  }

  async submit(session: SessionUser, input: SubmitInvoiceInput) {
    if (input.amountCents <= 0) throw new BadRequestException('amount must be positive');
    let contractorId: string | undefined;
    if (session.role === Role.CONTRACTOR) {
      const contractor = await this.resolveContractorForUser(session);
      if (!contractor) throw new ForbiddenException('No contractor profile linked to this user');
      contractorId = contractor.id;
    } else if (session.companyId) {
      // Company-side submission on behalf of a contractor (admin/HR flows)
      const any = await this.prisma.contractor.findFirst({ where: { companyId: session.companyId } });
      if (!any) throw new BadRequestException('No contractors in this company');
      contractorId = any.id;
    }
    if (!contractorId) throw new ForbiddenException('No contractor scope');

    const invoice = await this.prisma.contractorInvoice.create({
      data: {
        companyId: session.companyId!,
        contractorId,
        amountCents: input.amountCents,
        description: input.description,
        periodStart: new Date(input.periodStart),
        periodEnd: new Date(input.periodEnd),
        status: 'SUBMITTED',
      },
      include: { contractor: { select: { name: true, businessName: true } } },
    });
    await this.audit.record({
      actor: session,
      action: 'invoice.submitted',
      entityType: 'ContractorInvoice',
      entityId: invoice.id,
      after: { amountCents: invoice.amountCents, description: invoice.description },
    });
    return invoice;
  }

  async list(
    session: SessionUser,
    q: {
      status?: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'PAID';
      page?: number;
      pageSize?: number;
      mine?: boolean;
    },
  ) {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 20));
    const where: any = {
      ...(session.companyId ? { companyId: session.companyId } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    if (session.role === Role.CONTRACTOR) {
      const contractor = await this.resolveContractorForUser(session);
      where.contractorId = contractor?.id ?? '__none__';
    }
    const [items, total] = await Promise.all([
      this.prisma.contractorInvoice.findMany({
        where,
        include: {
          contractor: { select: { id: true, name: true, businessName: true, paymentTerms: true } },
          transfers: { orderBy: { createdAt: 'desc' } },
          approvedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.contractorInvoice.count({ where }),
    ]);
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  private async getScoped(session: SessionUser, id: string) {
    const invoice = await this.prisma.contractorInvoice.findFirst({
      where: {
        id,
        ...(session.companyId ? { companyId: session.companyId } : {}),
      },
      include: { contractor: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (session.role === Role.CONTRACTOR && invoice.contractor.userId !== session.id) {
      throw new NotFoundException('Invoice not found');
    }
    return invoice;
  }

  getOne(session: SessionUser, id: string) {
    return this.getScoped(session, id);
  }

  async approve(actor: SessionUser, id: string) {
    const invoice = await this.getScoped(actor, id);
    if (invoice.status !== 'SUBMITTED') {
      throw new BadRequestException(`Only SUBMITTED invoices can be approved (${invoice.status})`);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.contractorInvoice.update({
        where: { id },
        data: { status: 'APPROVED', approvedAt: new Date(), approvedById: actor.id },
      });
      await this.ledger.postTransaction(
        {
          companyId: invoice.companyId,
          description: `Contractor invoice approved — ${invoice.contractor.name}`,
          referenceType: 'invoice',
          referenceId: invoice.id,
          createdBy: actor.id,
          entries: [
            { accountCode: 'CONTRACTOR_EXPENSE', debit: invoice.amountCents, relatedEntityType: 'ContractorInvoice', relatedEntityId: invoice.id },
            { accountCode: 'CONTRACTOR_PAYABLE', credit: invoice.amountCents, relatedEntityType: 'ContractorInvoice', relatedEntityId: invoice.id },
          ],
        },
        tx,
      );
      return inv;
    });
    await this.audit.record({
      actor,
      action: 'invoice.approved',
      entityType: 'ContractorInvoice',
      entityId: id,
      before: { status: 'SUBMITTED' },
      after: { status: 'APPROVED', amountCents: invoice.amountCents },
    });
    return updated;
  }

  async reject(actor: SessionUser, id: string, reason: string) {
    const invoice = await this.getScoped(actor, id);
    if (invoice.status !== 'SUBMITTED') {
      throw new BadRequestException(`Only SUBMITTED invoices can be rejected (${invoice.status})`);
    }
    const updated = await this.prisma.contractorInvoice.update({
      where: { id },
      data: { status: 'REJECTED', rejectedAt: new Date(), rejectionReason: reason },
    });
    await this.audit.record({
      actor,
      action: 'invoice.rejected',
      entityType: 'ContractorInvoice',
      entityId: id,
      before: { status: 'SUBMITTED' },
      after: { status: 'REJECTED', reason },
    });
    return updated;
  }

  /** Batch payment: every APPROVED invoice gets its own ACH transfer. */
  async payBatch(actor: SessionUser, invoiceIds: string[]) {
    if (!invoiceIds?.length) throw new BadRequestException('invoiceIds required');
    const results: Array<{ invoiceId: string; transferId?: string; error?: string }> = [];
    for (const id of invoiceIds) {
      try {
        const invoice = await this.getScoped(actor, id);
        if (invoice.status !== 'APPROVED') {
          results.push({ invoiceId: id, error: `status is ${invoice.status}, expected APPROVED` });
          continue;
        }
        const transfer = await this.ach.initiateInvoiceTransfer({
          companyId: invoice.companyId,
          invoiceId: invoice.id,
          amountCents: invoice.amountCents,
        });
        await this.audit.record({
          actor,
          action: 'invoice.payment_initiated',
          entityType: 'ContractorInvoice',
          entityId: invoice.id,
          after: { transferId: transfer.id, amountCents: invoice.amountCents },
        });
        results.push({ invoiceId: id, transferId: transfer.id });
      } catch (err) {
        results.push({ invoiceId: id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { results };
  }
}
