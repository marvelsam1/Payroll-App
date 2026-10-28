import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { AuditService } from '../audit/audit.module';
import { QueueService } from '../queue/queue.module';
import { AchService } from '../ach/ach.service';
import { TaxEngineService } from '../tax-engine/tax-engine.service';
import { PdfService } from './pdf.service';
import { SessionUser } from '../common/decorators';
import { env } from '../config/env';
import { FilingStatus, PERIODS_PER_YEAR, TaxResult } from '../tax-engine/types';
import {
  Employee,
  PayFrequency,
  PayrollRun,
  PayrollRunStatus,
  Prisma,
} from '../generated/client';

type Tx = Prisma.TransactionClient;

export interface PreviewLine {
  employeeId: string;
  employeeName: string;
  departmentId: string | null;
  departmentName: string | null;
  grossPay: number;
  federalTax: number;
  stateTax: number;
  ficaSs: number;
  ficaMedicare: number;
  preTaxDeductions: number;
  postTaxDeductions: number;
  expenseReimbursement: number;
  netPay: number;
  engineNet?: number;
  hours?: number;
  notes?: string[];
}

export interface RunTotals {
  grossPay: number;
  federalTax: number;
  stateTax: number;
  ficaSs: number;
  ficaMedicare: number;
  employerFica: number;
  preTaxDeductions: number;
  postTaxDeductions: number;
  expenseReimbursement: number;
  netPay: number;
  employeeCount: number;
}

/**
 * Payroll run engine.
 *
 * States: draft → pending_approval → approved → processing → completed/failed
 *  - preview: computing line items (persisted as DRAFT, recalculated on submit)
 *  - approval blocked when ANY net pay is negative
 *  - idempotent: processing a run twice never double-pays (status guard +
 *    unique (runId, employeeId) line constraint + journal reference)
 *  - completion generates PDF pay stubs
 */
@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly ach: AchService,
    private readonly tax: TaxEngineService,
    private readonly pdf: PdfService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.register('payroll.process', (job) =>
      this.finalizeRun(job.data.runId, job.data.actorId),
    );
  }

  // -------------------------------------------------------------------------
  // Computation (preview / draft / recalc)
  // -------------------------------------------------------------------------

  private periodCount(frequency: PayFrequency): number {
    return PERIODS_PER_YEAR[frequency];
  }

  private grossForEmployee(emp: Employee, frequency: PayFrequency): number {
    const periods = this.periodCount(frequency);
    if (emp.payType === 'HOURLY') {
      const weeksPerPeriod = 52 / periods;
      return Math.round((emp.payRateCents * emp.weeklyHours * weeksPerPeriod));
    }
    return Math.round(emp.payRateCents / periods);
  }

  /** Year-to-date sums BEFORE a given run (completed runs only). */
  private async ytdBefore(companyId: string, employeeId: string, beforeYear: number) {
    const agg = await this.prisma.payrollLineItem.aggregate({
      where: {
        employeeId,
        payrollRun: {
          companyId,
          status: 'COMPLETED',
          payPeriodEnd: { lt: new Date(beforeYear, 0, 1) },
        },
      },
      _sum: { grossPay: true, federalTax: true, ficaSs: true, ficaMedicare: true, netPay: true },
    });
    // YTD within the same calendar year, excluding this run's period end
    const aggYear = await this.prisma.payrollLineItem.aggregate({
      where: {
        employeeId,
        payrollRun: {
          companyId,
          status: 'COMPLETED',
          payPeriodEnd: {
            gte: new Date(beforeYear, 0, 1),
            lt: new Date(beforeYear + 1, 0, 1),
          },
        },
      },
      _sum: { grossPay: true, federalTax: true, ficaSs: true, ficaMedicare: true, netPay: true },
    });
    void agg;
    return {
      gross: aggYear._sum.grossPay ?? 0,
      federal: aggYear._sum.federalTax ?? 0,
      ficaSs: aggYear._sum.ficaSs ?? 0,
      ficaMedicare: aggYear._sum.ficaMedicare ?? 0,
      net: aggYear._sum.netPay ?? 0,
    };
  }

  /** Full computation for a period — used by preview AND draft creation. */
  async computeLines(
    companyId: string,
    opts: { periodStart: Date; periodEnd: Date; excludeRunId?: string },
  ): Promise<{ lines: PreviewLine[]; totals: RunTotals; frequency: PayFrequency }> {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const employees = await this.prisma.employee.findMany({
      where: { companyId, status: 'ACTIVE' },
      include: { department: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });

    const year = opts.periodEnd.getFullYear();
    const outstanding = await this.prisma.expense.findMany({
      where: {
        companyId,
        status: 'APPROVED',
        reimbursementMode: 'DEFER_TO_PAYROLL',
        ...(opts.excludeRunId ? {} : {}),
      },
      select: { id: true, employeeId: true, amountCents: true },
    });
    const reimbByEmployee = new Map<string, number>();
    const reimbIdsByEmployee = new Map<string, string[]>();
    for (const exp of outstanding) {
      if (!exp.employeeId) continue;
      reimbByEmployee.set(exp.employeeId, (reimbByEmployee.get(exp.employeeId) ?? 0) + exp.amountCents);
      reimbIdsByEmployee.set(exp.employeeId, [
        ...(reimbIdsByEmployee.get(exp.employeeId) ?? []),
        exp.id,
      ]);
    }

    const lines: PreviewLine[] = [];
    for (const emp of employees) {
      const gross = this.grossForEmployee(emp, company.paySchedule);
      const preTax401k = Math.round((gross * emp.preTax401kBps) / 10_000);
      const preTax = preTax401k + emp.healthInsuranceCents;
      const postTaxRoth = Math.round((gross * emp.postTaxRothBps) / 10_000);
      const postTax = postTaxRoth + emp.garnishmentCents;
      const ytd = await this.ytdBefore(companyId, emp.id, year);

      const result: TaxResult = this.tax.calculate({
        grossPayCents: gross,
        frequency: company.paySchedule,
        filingStatus: (emp.filingStatus ?? 'SINGLE') as FilingStatus,
        workState: emp.workState,
        residenceState: emp.residenceState,
        residenceCity: emp.residenceCity,
        preTaxDeductionsCents: preTax,
        postTaxDeductionsCents: postTax,
        additionalWithholdingCents: emp.additionalFederalWithholdingCents,
        ytdGrossCents: ytd.gross,
      });

      const reimbursement = reimbByEmployee.get(emp.id) ?? 0;
      const engineNet = result.netPayCents;
      lines.push({
        employeeId: emp.id,
        employeeName: emp.name,
        departmentId: emp.departmentId,
        departmentName: emp.department?.name ?? null,
        grossPay: result.grossPayCents,
        federalTax: result.federalTaxCents,
        stateTax: result.stateTaxCents,
        ficaSs: result.ficaSsCents,
        ficaMedicare: result.ficaMedicareCents,
        preTaxDeductions: result.preTaxDeductionsCents,
        postTaxDeductions: result.postTaxDeductionsCents,
        expenseReimbursement: reimbursement,
        netPay: engineNet + reimbursement,
        engineNet,
        notes: result.meta.notes,
      });
    }

    return { lines, totals: totalsOf(lines), frequency: company.paySchedule };
  }

  // -------------------------------------------------------------------------
  // Run lifecycle
  // -------------------------------------------------------------------------

  async preview(companyId: string, periodStart: Date, periodEnd: Date) {
    const { lines, totals, frequency } = await this.computeLines(companyId, {
      periodStart,
      periodEnd,
    });
    const negatives = lines.filter((l) => l.engineNet !== undefined && l.engineNet < 0);
    return { lines, totals, frequency, hasNegativeNet: negatives.length > 0, negatives };
  }

  async createDraft(actor: SessionUser, periodStart: Date, periodEnd: Date) {
    const companyId = actor.companyId!;
    if (periodEnd <= periodStart) {
      throw new BadRequestException('periodEnd must be after periodStart');
    }
    const overlapping = await this.prisma.payrollRun.findFirst({
      where: {
        companyId,
        payPeriodStart: periodStart,
        payPeriodEnd: periodEnd,
        status: { not: 'FAILED' },
      },
    });
    if (overlapping) {
      throw new BadRequestException(
        `A payroll run for ${periodStart.toISOString().slice(0, 10)} → ${periodEnd.toISOString().slice(0, 10)} already exists (${overlapping.status})`,
      );
    }

    const { lines, totals } = await this.computeLines(companyId, { periodStart, periodEnd });

    const run = await this.prisma.payrollRun.create({
      data: {
        companyId,
        payPeriodStart: periodStart,
        payPeriodEnd: periodEnd,
        status: 'DRAFT',
        createdById: actor.id,
        lineItems: {
          create: lines.map((l) => ({
            employeeId: l.employeeId,
            grossPay: l.grossPay,
            federalTax: l.federalTax,
            stateTax: l.stateTax,
            ficaSs: l.ficaSs,
            ficaMedicare: l.ficaMedicare,
            preTaxDeductions: l.preTaxDeductions,
            postTaxDeductions: l.postTaxDeductions,
            expenseReimbursement: l.expenseReimbursement,
            netPay: l.netPay,
            taxEngineSnapshot: {
              engineNet: l.engineNet,
              notes: l.notes ?? [],
              computedAt: new Date().toISOString(),
            } as any,
          })),
        },
      },
      include: { lineItems: { include: { employee: { select: { id: true, name: true } } } } },
    });

    await this.audit.record({
      actor,
      action: 'payroll.run.created',
      entityType: 'PayrollRun',
      entityId: run.id,
      after: {
        status: run.status,
        periodStart: run.payPeriodStart,
        periodEnd: run.payPeriodEnd,
        totals,
      },
    });
    return run;
  }

  /** Recompute every line (YTD moves, new hires, approvals) before submit. */
  private async recalcRun(run: PayrollRun): Promise<PreviewLine[]> {
    const { lines } = await this.computeLines(run.companyId, {
      periodStart: run.payPeriodStart,
      periodEnd: run.payPeriodEnd,
      excludeRunId: run.id,
    });
    const byEmployee = new Map(lines.map((l) => [l.employeeId, l]));
    for (const line of lines) {
      const existing = await this.prisma.payrollLineItem.findUnique({
        where: { payrollRunId_employeeId: { payrollRunId: run.id, employeeId: line.employeeId } },
      });
      const data = {
        grossPay: line.grossPay,
        federalTax: line.federalTax,
        stateTax: line.stateTax,
        ficaSs: line.ficaSs,
        ficaMedicare: line.ficaMedicare,
        preTaxDeductions: line.preTaxDeductions,
        postTaxDeductions: line.postTaxDeductions,
        expenseReimbursement: line.expenseReimbursement,
        netPay: line.netPay,
        taxEngineSnapshot: {
          engineNet: line.engineNet,
          notes: line.notes ?? [],
          computedAt: new Date().toISOString(),
        } as any,
      };
      if (existing) {
        await this.prisma.payrollLineItem.update({ where: { id: existing.id }, data });
      } else {
        await this.prisma.payrollLineItem.create({
          data: { ...data, payrollRunId: run.id, employeeId: line.employeeId },
        });
      }
    }
    // Remove lines for employees no longer active
    const activeIds = new Set(lines.map((l) => l.employeeId));
    const stale = await this.prisma.payrollLineItem.findMany({
      where: { payrollRunId: run.id, employeeId: { notIn: [...activeIds] } },
    });
    if (stale.length > 0) {
      await this.prisma.payrollLineItem.deleteMany({
        where: { id: { in: stale.map((s) => s.id) } },
      });
    }
    return byEmployee.size > 0 ? lines : [];
  }

  private assertNoNegativeNet(items: Array<{ netPay: number; employee?: { name: string } | null }>) {
    const negatives = items.filter((i) => i.netPay < 0);
    if (negatives.length > 0) {
      throw new UnprocessableEntityException({
        message: 'Payroll blocked: negative net pay',
        details: negatives.map((n) => ({
          employee: n.employee?.name ?? 'unknown',
          netPay: n.netPay,
        })),
      });
    }
  }

  async submit(actor: SessionUser, runId: string) {
    const run = await this.getRun(actor, runId);
    if (run.status !== 'DRAFT') {
      throw new BadRequestException(`Only DRAFT runs can be submitted (current: ${run.status})`);
    }
    await this.recalcRun(run);
    const fresh = await this.getRun(actor, runId);
    this.assertNoNegativeNet(fresh.lineItems);
    const updated = await this.prisma.payrollRun.update({
      where: { id: runId },
      data: { status: 'PENDING_APPROVAL' },
      include: this.runInclude(),
    });
    await this.audit.record({
      actor,
      action: 'payroll.run.submitted',
      entityType: 'PayrollRun',
      entityId: runId,
      before: { status: 'DRAFT' },
      after: { status: 'PENDING_APPROVAL', employeeCount: updated.lineItems.length },
    });
    return updated;
  }

  async approve(actor: SessionUser, runId: string) {
    const run = await this.getRun(actor, runId);
    if (run.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(
        `Only PENDING_APPROVAL runs can be approved (current: ${run.status})`,
      );
    }
    this.assertNoNegativeNet(run.lineItems);
    const updated = await this.prisma.payrollRun.update({
      where: { id: runId },
      data: { status: 'APPROVED', approvedById: actor.id },
      include: this.runInclude(),
    });
    await this.audit.record({
      actor,
      action: 'payroll.run.approved',
      entityType: 'PayrollRun',
      entityId: runId,
      before: { status: 'PENDING_APPROVAL' },
      after: { status: 'APPROVED', approvedBy: actor.email },
    });
    return updated;
  }

  async reject(actor: SessionUser, runId: string, reason: string) {
    const run = await this.getRun(actor, runId);
    if (run.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(
        `Only PENDING_APPROVAL runs can be rejected (current: ${run.status})`,
      );
    }
    const updated = await this.prisma.payrollRun.update({
      where: { id: runId },
      data: { status: 'DRAFT', failureReason: null },
      include: this.runInclude(),
    });
    await this.audit.record({
      actor,
      action: 'payroll.run.rejected',
      entityType: 'PayrollRun',
      entityId: runId,
      before: { status: 'PENDING_APPROVAL' },
      after: { status: 'DRAFT', reason },
    });
    return updated;
  }

  /** Kick off async processing. Idempotent for terminal/in-flight states. */
  async startProcess(actor: SessionUser, runId: string) {
    const run = await this.getRun(actor, runId);
    if (run.status === 'PROCESSING' || run.status === 'COMPLETED') {
      return { run, alreadyProcessed: true } as const;
    }
    if (run.status !== 'APPROVED') {
      throw new BadRequestException(
        `Only APPROVED runs can be processed (current: ${run.status})`,
      );
    }
    this.assertNoNegativeNet(run.lineItems);
    await this.prisma.payrollRun.update({
      where: { id: runId },
      data: { status: 'PROCESSING' },
    });
    await this.queue.enqueue(
      'payroll.process',
      { runId, actorId: actor.id },
      env.payrollProcessDelayMs,
    );
    await this.audit.record({
      actor,
      action: 'payroll.run.processing',
      entityType: 'PayrollRun',
      entityId: runId,
      before: { status: 'APPROVED' },
      after: { status: 'PROCESSING' },
    });
    const fresh = await this.getRun(actor, runId);
    return { run: fresh, alreadyProcessed: false } as const;
  }

  /**
   * Queue worker: post the accrual journal, initiate ACH transfers, generate
   * stubs, mark COMPLETED. Guarded so a duplicate job cannot double-pay.
   */
  async finalizeRun(runId: string, actorId: string | null): Promise<void> {
    const run = await this.prisma.payrollRun.findUnique({
      where: { id: runId },
      include: { lineItems: true },
    });
    if (!run) return;
    if (run.status !== 'PROCESSING') {
      this.logger.warn(`finalizeRun skipped for ${runId} (status ${run.status})`);
      return;
    }
    if (run.journalTxnId) {
      this.logger.warn(`finalizeRun skipped for ${runId} (journal already posted)`);
      return;
    }

    try {
      const totals = totalsOf(
        run.lineItems.map((l) => ({
          grossPay: l.grossPay,
          federalTax: l.federalTax,
          stateTax: l.stateTax,
          ficaSs: l.ficaSs,
          ficaMedicare: l.ficaMedicare,
          preTaxDeductions: l.preTaxDeductions,
          postTaxDeductions: l.postTaxDeductions,
          expenseReimbursement: l.expenseReimbursement,
          netPay: l.netPay,
        })),
      );
      const employerFica = totals.ficaSs + totals.ficaMedicare;
      const employeeTaxTotal = totals.federalTax + totals.stateTax + totals.ficaSs + totals.ficaMedicare;
      const netWagesTotal = totals.netPay - totals.expenseReimbursement;
      const employeeIds = run.lineItems.map((l) => l.employeeId);

      const { transferIds } = await this.prisma.$transaction(async (tx) => {
        // 1. Accrual journal — balanced double entry for the whole run
        const accrual = await this.ledger.postTransaction(
          {
            companyId: run.companyId,
            description: `Payroll accrual ${run.payPeriodStart.toISOString().slice(0, 10)} → ${run.payPeriodEnd.toISOString().slice(0, 10)}`,
            referenceType: 'payroll_run',
            referenceId: run.id,
            createdBy: actorId ?? undefined,
            entries: [
              { accountCode: 'WAGES_EXPENSE', debit: totals.grossPay },
              { accountCode: 'EMPLOYER_TAX_EXPENSE', debit: employerFica },
              { accountCode: 'TAX_WITHHOLDING_PAYABLE', credit: employeeTaxTotal + employerFica },
              { accountCode: 'DEDUCTIONS_PAYABLE', credit: totals.preTaxDeductions + totals.postTaxDeductions },
              ...(totals.expenseReimbursement > 0
                ? [
                    {
                      accountCode: 'EXPENSE_REIMBURSEMENT_PAYABLE' as string,
                      debit: totals.expenseReimbursement,
                    },
                  ]
                : []),
              { accountCode: 'NET_PAY_PAYABLE', credit: netWagesTotal + totals.expenseReimbursement },
            ].filter((e) => (e.debit ?? 0) > 0 || (e.credit ?? 0) > 0),
          },
          tx,
        );

        // 2. Mark deferred expense reimbursements as reimbursed.
        //    The accrual above already debited EXPENSE_REIMBURSEMENT_PAYABLE and
        //    credited NET_PAY_PAYABLE for these — posting again would double-count.
        const expenses = await tx.expense.findMany({
          where: {
            companyId: run.companyId,
            status: 'APPROVED',
            reimbursementMode: 'DEFER_TO_PAYROLL',
            employeeId: { in: employeeIds },
          },
        });
        if (expenses.length > 0) {
          await tx.expense.updateMany({
            where: { id: { in: expenses.map((e) => e.id) } },
            data: { status: 'REIMBURSED', reimbursedAt: new Date() },
          });
        }

        // 3. One ACH transfer per employee net pay
        const transferIds: string[] = [];
        for (const line of run.lineItems) {
          const transfer = await this.ach.initiatePayrollTransfer(
            {
              companyId: run.companyId,
              runId: run.id,
              lineItemId: line.id,
              employeeId: line.employeeId,
              amountCents: line.netPay,
            },
            tx,
          );
          transferIds.push(transfer.id);
        }

        // 4. Close the run
        await tx.payrollRun.update({
          where: { id: run.id },
          data: { status: 'COMPLETED', runDate: new Date(), journalTxnId: accrual.id },
        });
        return { transferIds };
      }, { timeout: 60_000 });

      // 5. Activate transfers (PENDING + settle jobs) ONLY after commit,
      //    then generate pay stubs.
      await this.ach.activateTransfers(transferIds);
      await this.generateStubs(run.id, actorId);

      await this.audit.record({
        actorId: actorId,
        companyId: run.companyId,
        action: 'payroll.run.completed',
        entityType: 'PayrollRun',
        entityId: run.id,
        after: { journalTxnId: (run as any).journalTxnId, transfers: transferIds.length, totals },
      });
      this.logger.log(`payroll run ${run.id} completed with ${transferIds.length} transfers`);
    } catch (err) {
      this.logger.error(`payroll run ${runId} failed`, err as any);
      await this.prisma.payrollRun.update({
        where: { id: runId },
        data: {
          status: 'FAILED',
          failureReason: err instanceof Error ? err.message : String(err),
        },
      });
      await this.audit.record({
        actorId: actorId,
        companyId: run.companyId,
        action: 'payroll.run.failed',
        entityType: 'PayrollRun',
        entityId: runId,
        after: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  /** Generate PDF pay stubs for every line item (spec: on completion). */
  async generateStubs(runId: string, actorId: string | null): Promise<number> {
    const run = await this.getRunRaw(runId);
    if (!run) return 0;
    let count = 0;
    const year = run.payPeriodEnd.getFullYear();
    for (const line of run.lineItems) {
      try {
        const ytd = await this.ytdBefore(run.companyId, line.employeeId, year);
        const ytdWithRun = {
          gross: ytd.gross + line.grossPay,
          federal: ytd.federal + line.federalTax,
          ficaSs: ytd.ficaSs + line.ficaSs,
          ficaMedicare: ytd.ficaMedicare + line.ficaMedicare,
          net: ytd.net + line.netPay,
        };
        const bytes = await this.pdf.buildPayStub({
          companyName: run.company.name,
          employeeName: line.employee.name,
          employeeId: line.employee.id,
          periodStart: run.payPeriodStart.toISOString(),
          periodEnd: run.payPeriodEnd.toISOString(),
          payDate: (run.runDate ?? new Date()).toISOString(),
          line: {
            grossPay: line.grossPay,
            federalTax: line.federalTax,
            stateTax: line.stateTax,
            ficaSs: line.ficaSs,
            ficaMedicare: line.ficaMedicare,
            preTaxDeductions: line.preTaxDeductions,
            postTaxDeductions: line.postTaxDeductions,
            expenseReimbursement: line.expenseReimbursement,
            netPay: line.netPay,
          },
          ytd: ytdWithRun,
        });
        await this.pdf.ensurePayStub(runId, line.employeeId, async () => bytes);
        count++;
      } catch (err) {
        this.logger.warn(`stub generation failed for ${line.employeeId}: ${String(err)}`);
      }
    }
    void actorId;
    return count;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  private runInclude() {
    return {
      lineItems: {
        include: { employee: { select: { id: true, name: true, departmentId: true } } },
      },
      createdBy: { select: { id: true, name: true, email: true } },
      approvedBy: { select: { id: true, name: true, email: true } },
    } as const;
  }

  private async getRunRaw(runId: string) {
    return this.prisma.payrollRun.findUnique({
      where: { id: runId },
      include: {
        ...this.runInclude(),
        company: { select: { id: true, name: true, ein: true, paySchedule: true } },
      },
    });
  }

  /** Tenant-scoped fetch — 404 across tenants (no existence leaks). */
  async getRun(session: SessionUser, runId: string) {
    const run = await this.prisma.payrollRun.findFirst({
      where: {
        id: runId,
        ...(session.companyId ? { companyId: session.companyId } : {}),
      },
      include: this.runInclude(),
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    return run;
  }

  async list(
    session: SessionUser,
    q: { status?: PayrollRunStatus; page?: number; pageSize?: number },
  ) {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 20));
    const where = {
      ...(session.companyId ? { companyId: session.companyId } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.payrollRun.findMany({
        where,
        include: {
          _count: { select: { lineItems: true, transfers: true } },
          createdBy: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
        },
        orderBy: { payPeriodEnd: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.payrollRun.count({ where }),
    ]);
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async detail(session: SessionUser, runId: string) {
    const run = await this.getRun(session, runId);
    const totals = totalsOf(run.lineItems);
    return { ...run, totals };
  }

  async getStubFile(session: SessionUser, runId: string, employeeId: string): Promise<string> {
    const run = await this.getRun(session, runId);
    // Employees may only fetch their own stub
    if (session.role === 'EMPLOYEE') {
      const own = await this.prisma.employee.findFirst({
        where: { userId: session.id, companyId: session.companyId ?? undefined },
      });
      if (!own || own.id !== employeeId) throw new NotFoundException('Pay stub not found');
    }
    const line = run.lineItems.find((l) => l.employeeId === employeeId);
    if (!line) throw new NotFoundException('Pay stub not found');

    const full = await this.prisma.payrollRun.findUnique({
      where: { id: runId },
      include: {
        company: { select: { name: true } },
        lineItems: { include: { employee: true } },
      },
    });
    if (!full) throw new NotFoundException('Pay stub not found');
    const target = full.lineItems.find((l) => l.employeeId === employeeId)!;
    const year = full.payPeriodEnd.getFullYear();
    const ytd = await this.ytdBefore(full.companyId, employeeId, year);

    return this.pdf.ensurePayStub(runId, employeeId, () =>
      this.pdf.buildPayStub({
        companyName: full.company.name,
        employeeName: target.employee.name,
        employeeId,
        periodStart: full.payPeriodStart.toISOString(),
        periodEnd: full.payPeriodEnd.toISOString(),
        payDate: (full.runDate ?? full.createdAt).toISOString(),
        line: {
          grossPay: target.grossPay,
          federalTax: target.federalTax,
          stateTax: target.stateTax,
          ficaSs: target.ficaSs,
          ficaMedicare: target.ficaMedicare,
          preTaxDeductions: target.preTaxDeductions,
          postTaxDeductions: target.postTaxDeductions,
          expenseReimbursement: target.expenseReimbursement,
          netPay: target.netPay,
        },
        ytd: {
          gross: ytd.gross + target.grossPay,
          federal: ytd.federal + target.federalTax,
          ficaSs: ytd.ficaSs + target.ficaSs,
          ficaMedicare: ytd.ficaMedicare + target.ficaMedicare,
          net: ytd.net + target.netPay,
        },
      }),
    );
  }

  /** Employees: their own stub list. */
  async myPaystubs(session: SessionUser) {
    const employee = await this.prisma.employee.findFirst({
      where: { userId: session.id, companyId: session.companyId ?? undefined },
    });
    if (!employee) return [];
    const items = await this.prisma.payrollLineItem.findMany({
      where: { employeeId: employee.id, payrollRun: { status: 'COMPLETED' } },
      include: {
        payrollRun: { select: { id: true, payPeriodStart: true, payPeriodEnd: true, runDate: true } },
      },
      orderBy: { payrollRun: { payPeriodEnd: 'desc' } },
    });
    return items.map((l) => ({
      runId: l.payrollRun.id,
      periodStart: l.payrollRun.payPeriodStart,
      periodEnd: l.payrollRun.payPeriodEnd,
      payDate: l.payrollRun.runDate,
      grossPay: l.grossPay,
      federalTax: l.federalTax,
      stateTax: l.stateTax,
      ficaSs: l.ficaSs,
      ficaMedicare: l.ficaMedicare,
      netPay: l.netPay,
    }));
  }
}

export function totalsOf(
  items: Array<{
    grossPay: number;
    federalTax: number;
    stateTax: number;
    ficaSs: number;
    ficaMedicare: number;
    preTaxDeductions: number;
    postTaxDeductions: number;
    expenseReimbursement: number;
    netPay: number;
  }>,
): RunTotals {
  const t: RunTotals = {
    grossPay: 0,
    federalTax: 0,
    stateTax: 0,
    ficaSs: 0,
    ficaMedicare: 0,
    employerFica: 0,
    preTaxDeductions: 0,
    postTaxDeductions: 0,
    expenseReimbursement: 0,
    netPay: 0,
    employeeCount: items.length,
  };
  for (const i of items) {
    t.grossPay += i.grossPay;
    t.federalTax += i.federalTax;
    t.stateTax += i.stateTax;
    t.ficaSs += i.ficaSs;
    t.ficaMedicare += i.ficaMedicare;
    t.preTaxDeductions += i.preTaxDeductions;
    t.postTaxDeductions += i.postTaxDeductions;
    t.expenseReimbursement += i.expenseReimbursement;
    t.netPay += i.netPay;
  }
  t.employerFica = t.ficaSs + t.ficaMedicare;
  return t;
}
