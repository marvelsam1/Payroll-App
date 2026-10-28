import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { AuditService } from '../audit/audit.module';
import { QueueService } from '../queue/queue.module';
import { SessionUser } from '../common/decorators';
import { env } from '../config/env';
import { BankTransfer, Prisma, TransferStatus } from '../generated/client';

type Tx = Prisma.TransactionClient;

export const ACH_FAILURE_CODES = ['R01', 'R02', 'R03'] as const;
export type AchFailureCode = (typeof ACH_FAILURE_CODES)[number];

export const FAILURE_CODE_MEANING: Record<AchFailureCode, string> = {
  R01: 'Insufficient funds (NSF)',
  R02: 'Account closed',
  R03: 'No account / unable to locate account',
};

/**
 * Simulated ACH money movement.
 *
 * State machine (per spec):
 *   initiated → pending → processing → settled
 *   initiated → pending → failed
 *
 * Ledger postings (transit model keeps cash movement auditable):
 *   initiate : Dr ACH_TRANSIT / Cr OPERATING_CASH   (money leaves operating)
 *   settle   : Dr <payable>  / Cr ACH_TRANSIT      (payable discharged)
 *   fail     : Dr OPERATING_CASH / Cr ACH_TRANSIT  (reversal of initiation,
 *              each entry cross-linked via reversedEntryId)
 *
 * "Chaos mode" (per-company flag) injects deterministic-classic ACH return
 * codes R01/R02/R03. Settlement is asynchronous via the job queue with a
 * simulated delay.
 */
@Injectable()
export class AchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.register('ach.settle', (job) => this.handleSettleJob(job.data.transferId));
  }

  /** Enqueue a settle job for a freshly initiated transfer. */
  private scheduleSettle(transferId: string): Promise<void> {
    return this.queue.enqueue('ach.settle', { transferId }, env.achSettleDelayMs);
  }

  /**
   * Initiate payment of one payroll line item's net pay.
   * When joining an outer transaction (payroll processing), the caller MUST
   * call `activateTransfers` after commit — that is when the state moves to
   * PENDING and the settle job is scheduled (never before commit, so jobs
   * can't observe uncommitted rows).
   */
  async initiatePayrollTransfer(
    input: { companyId: string; runId: string; lineItemId: string; employeeId: string; amountCents: number },
    outerTx?: Tx,
  ): Promise<BankTransfer> {
    const create = async (tx: Tx) => {
      const transfer = await tx.bankTransfer.create({
        data: {
          companyId: input.companyId,
          payrollRunId: input.runId,
          payrollLineItemId: input.lineItemId,
          employeeId: input.employeeId,
          amountCents: input.amountCents,
          status: 'INITIATED',
          initiatedAt: new Date(),
        },
      });
      await this.initiatePosting(tx, input.companyId, transfer.id, input.amountCents);
      return transfer;
    };
    const transfer = outerTx ? await create(outerTx) : await this.prisma.$transaction(create);
    if (!outerTx) await this.markPending(transfer.id);
    return transfer;
  }

  /** Move freshly created transfers to PENDING and schedule settlement. */
  async activateTransfers(transferIds: string[]): Promise<void> {
    for (const id of transferIds) {
      await this.prisma.bankTransfer.updateMany({
        where: { id, status: 'INITIATED' },
        data: { status: 'PENDING' },
      });
      await this.scheduleSettle(id);
    }
  }

  /** Initiate payment of an approved contractor invoice. */
  async initiateInvoiceTransfer(input: {
    companyId: string;
    invoiceId: string;
    amountCents: number;
  }): Promise<BankTransfer> {
    const transfer = await this.prisma.$transaction(async (tx) => {
      const t = await tx.bankTransfer.create({
        data: {
          companyId: input.companyId,
          invoiceId: input.invoiceId,
          amountCents: input.amountCents,
          status: 'INITIATED',
          initiatedAt: new Date(),
        },
      });
      await this.initiatePosting(tx, input.companyId, t.id, input.amountCents);
      return t;
    });
    // markPending() moves INITIATED → PENDING and schedules the settle job
    await this.markPending(transfer.id);
    return (await this.prisma.bankTransfer.findUniqueOrThrow({ where: { id: transfer.id } }))!;
  }

  /** Cash out of operating into transit (balanced). */
  private async initiatePosting(tx: Tx, companyId: string, transferId: string, amountCents: number) {
    await this.ledger.postTransaction(
      {
        companyId,
        description: `ACH payment initiated (${transferId})`,
        referenceType: 'transfer_initiation',
        referenceId: transferId,
        entries: [
          {
            accountCode: 'ACH_TRANSIT',
            debit: amountCents,
            relatedEntityType: 'BankTransfer',
            relatedEntityId: transferId,
          },
          { accountCode: 'OPERATING_CASH', credit: amountCents },
        ],
      },
      tx,
    );
  }

  private async markPending(transferId: string): Promise<void> {
    await this.prisma.bankTransfer.update({
      where: { id: transferId },
      data: { status: 'PENDING' },
    });
    await this.scheduleSettle(transferId);
  }

  /** Queue job handler — walks pending → processing → settled/failed. */
  async handleSettleJob(transferId: string): Promise<void> {
    const transfer = await this.prisma.bankTransfer.findUnique({ where: { id: transferId } });
    if (!transfer || transfer.status === 'SETTLED' || transfer.status === 'FAILED') return;
    if (transfer.status === 'INITIATED') {
      await this.prisma.bankTransfer.update({
        where: { id: transferId },
        data: { status: 'PENDING' },
      });
    }
    await this.prisma.bankTransfer.update({
      where: { id: transferId },
      data: { status: 'PROCESSING' },
    });

    // simulated processing window
    await new Promise((r) => setTimeout(r, env.achProcessingDelayMs));

    const company = await this.prisma.company.findUnique({
      where: { id: transfer.companyId },
      select: { chaosMode: true },
    });
    const failureCode = company?.chaosMode ? this.pickChaosCode(transferId) : null;
    if (failureCode) await this.fail(transferId, failureCode);
    else await this.settle(transferId);
  }

  /** Injectable chaos: stable per-transfer pick from classic return codes. */
  private pickChaosCode(transferId: string): AchFailureCode {
    let hash = 0;
    for (const ch of transferId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return ACH_FAILURE_CODES[hash % ACH_FAILURE_CODES.length];
  }

  /** settled: Dr <payable> / Cr ACH_TRANSIT */
  async settle(transferId: string): Promise<BankTransfer> {
    const transfer = await this.prisma.bankTransfer.findUnique({ where: { id: transferId } });
    if (!transfer) throw new NotFoundException('Transfer not found');
    if (transfer.status === 'SETTLED') return transfer;

    const payableCode = transfer.invoiceId
      ? 'CONTRACTOR_PAYABLE'
      : 'NET_PAY_PAYABLE';

    const updated = await this.prisma.$transaction(async (tx) => {
      // Atomic claim — guarantees exactly-once settlement even if two jobs race
      const claim = await tx.bankTransfer.updateMany({
        where: { id: transfer.id, status: { in: ['INITIATED', 'PENDING', 'PROCESSING'] } },
        data: { status: 'SETTLED', settledAt: new Date() },
      });
      if (claim.count === 0) return null;
      await this.ledger.postTransaction(
        {
          companyId: transfer.companyId,
          description: `ACH payment settled (${transfer.id})`,
          referenceType: 'transfer_settlement',
          referenceId: transfer.id,
          entries: [
            {
              accountCode: payableCode,
              debit: transfer.amountCents,
              relatedEntityType: 'BankTransfer',
              relatedEntityId: transfer.id,
            },
            {
              accountCode: 'ACH_TRANSIT',
              credit: transfer.amountCents,
              relatedEntityType: 'BankTransfer',
              relatedEntityId: transfer.id,
            },
          ],
        },
        tx,
      );
      if (transfer.invoiceId) {
        await tx.contractorInvoice.update({
          where: { id: transfer.invoiceId },
          data: { status: 'PAID', paidAt: new Date() },
        });
      }
      return tx.bankTransfer.findUniqueOrThrow({ where: { id: transfer.id } });
    });
    if (!updated) {
      // another worker settled it first
      return (await this.prisma.bankTransfer.findUniqueOrThrow({ where: { id: transfer.id } }))!;
    }

    await this.audit.record({
      companyId: transfer.companyId,
      actorId: null,
      actorEmail: 'system@payledger.local',
      action: 'ach.transfer.settled',
      entityType: 'BankTransfer',
      entityId: transfer.id,
      before: { status: transfer.status },
      after: { status: 'SETTLED', amountCents: transfer.amountCents },
    });
    return updated;
  }

  /** failed: reversal of the initiation posting (visible audit trail). */
  async fail(transferId: string, failureCode: AchFailureCode): Promise<BankTransfer> {
    const transfer = await this.prisma.bankTransfer.findUnique({ where: { id: transferId } });
    if (!transfer) throw new NotFoundException('Transfer not found');
    if (transfer.status === 'FAILED') return transfer;

    const initiationEntries = await this.prisma.ledgerEntry.findMany({
      where: {
        companyId: transfer.companyId,
        relatedEntityType: 'BankTransfer',
        relatedEntityId: transfer.id,
        transaction: { referenceType: 'transfer_initiation' },
      },
    });
    const transitEntry = initiationEntries.find((e) => e.debitAmount > 0);
    const cashEntry = initiationEntries.find((e) => e.creditAmount > 0);

    const updated = await this.prisma.$transaction(async (tx) => {
      // Atomic claim — exactly-once failure posting even under job races
      const claim = await tx.bankTransfer.updateMany({
        where: { id: transfer.id, status: { in: ['INITIATED', 'PENDING', 'PROCESSING'] } },
        data: { status: 'FAILED', failureCode },
      });
      if (claim.count === 0) return null;
      await this.ledger.postTransaction(
        {
          companyId: transfer.companyId,
          description: `ACH payment failed (${failureCode}: ${FAILURE_CODE_MEANING[failureCode]}) — reversal of initiation`,
          referenceType: 'transfer_failure',
          referenceId: transfer.id,
          entries: [
            {
              accountCode: 'OPERATING_CASH',
              debit: transfer.amountCents,
              reversedEntryId: cashEntry?.id,
            },
            {
              accountCode: 'ACH_TRANSIT',
              credit: transfer.amountCents,
              reversedEntryId: transitEntry?.id,
            },
          ],
        },
        tx,
      );
      if (transfer.invoiceId) {
        // invoice stays APPROVED (payable still owed) — retriable
        await tx.contractorInvoice.update({
          where: { id: transfer.invoiceId },
          data: { status: 'APPROVED' },
        });
      }
      return tx.bankTransfer.findUniqueOrThrow({ where: { id: transfer.id } });
    });
    if (!updated) {
      return (await this.prisma.bankTransfer.findUniqueOrThrow({ where: { id: transfer.id } }))!;
    }

    await this.audit.record({
      companyId: transfer.companyId,
      actorId: null,
      actorEmail: 'system@payledger.local',
      action: 'ach.transfer.failed',
      entityType: 'BankTransfer',
      entityId: transfer.id,
      before: { status: transfer.status },
      after: { status: 'FAILED', failureCode, meaning: FAILURE_CODE_MEANING[failureCode] },
    });
    return updated;
  }

  /** Retry a failed transfer — creates a NEW transfer (attempt+1). */
  async retry(actor: SessionUser, transferId: string): Promise<BankTransfer> {
    const original = await this.prisma.bankTransfer.findUnique({ where: { id: transferId } });
    if (!original || (actor.companyId && original.companyId !== actor.companyId)) {
      throw new NotFoundException('Transfer not found');
    }
    if (original.status !== 'FAILED') {
      throw new BadRequestException('Only failed transfers can be retried');
    }

    const retry = await this.prisma.$transaction(async (tx) => {
      const t = await tx.bankTransfer.create({
        data: {
          companyId: original.companyId,
          payrollRunId: original.payrollRunId,
          payrollLineItemId: original.payrollLineItemId,
          invoiceId: original.invoiceId,
          employeeId: original.employeeId,
          amountCents: original.amountCents,
          status: 'INITIATED',
          initiatedAt: new Date(),
          attempt: original.attempt + 1,
        },
      });
      await this.initiatePosting(tx, original.companyId, t.id, t.amountCents);
      return t;
    });

    await this.prisma.bankTransfer.update({
      where: { id: retry.id },
      data: { status: 'PENDING' },
    });
    await this.scheduleSettle(retry.id);

    await this.audit.record({
      actor,
      action: 'ach.transfer.retried',
      entityType: 'BankTransfer',
      entityId: original.id,
      before: { status: 'FAILED', failureCode: original.failureCode },
      after: { retryId: retry.id, attempt: retry.attempt },
    });
    return retry;
  }

  async list(
    companyId: string,
    q: {
      status?: TransferStatus;
      payrollRunId?: string;
      invoiceId?: string;
      employeeId?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 25));
    const where: Prisma.BankTransferWhereInput = {
      companyId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.payrollRunId ? { payrollRunId: q.payrollRunId } : {}),
      ...(q.invoiceId ? { invoiceId: q.invoiceId } : {}),
      ...(q.employeeId ? { employeeId: q.employeeId } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.bankTransfer.findMany({
        where,
        include: {
          invoice: { select: { id: true, description: true, status: true } },
          employee: { select: { id: true, name: true } },
          payrollRun: { select: { id: true, payPeriodStart: true, payPeriodEnd: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.bankTransfer.count({ where }),
    ]);
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getOne(companyId: string, id: string) {
    const transfer = await this.prisma.bankTransfer.findFirst({
      where: { id, companyId },
      include: { invoice: true, employee: true, payrollRun: true },
    });
    if (!transfer) throw new NotFoundException('Transfer not found');
    return transfer;
  }
}
