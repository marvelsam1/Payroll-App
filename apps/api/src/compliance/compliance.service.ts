import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PdfService } from '../payroll/pdf.service';
import { PERIODS_PER_YEAR } from '../tax-engine/types';
import { PayFrequency, Prisma } from '../generated/client';

const SUTA_WAGE_BASE_CENTS = 1_000_000; // $10,000 typical state wage base (simulated)
const SUTA_RATE_BPS = 270; // 2.70% simulated experience rate

interface CalendarEvent {
  date: string;
  form: '941' | 'W-2' | 'SUTA';
  title: string;
  period: string;
  status: 'upcoming' | 'overdue' | 'simulated_filed';
  due: boolean;
}

/**
 * Compliance simulation: jurisdiction rules, filing calendar, and watermarked
 * ("SIMULATED — NOT FOR FILING") PDF mockups populated with real ledger +
 * payroll data. NO real filings occur.
 */
@Injectable()
export class ComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
  ) {}

  private quarterOf(monthIndex: number): number {
    return Math.floor(monthIndex / 3) + 1;
  }

  /** Statutory-ish due dates (simulated): 941/SUTA quarterly, W-2 annually. */
  async calendar(companyId: string, year: number): Promise<CalendarEvent[]> {
    const events: CalendarEvent[] = [];
    const today = new Date();
    const dayAfter = (y: number, m: number, d: number) => new Date(y, m, d + 1);

    const quarterDue = [
      { q: 1, date: new Date(year, 3, 30) }, // Apr 30 (Q1)
      { q: 2, date: new Date(year, 6, 31) }, // Jul 31 (Q2)
      { q: 3, date: new Date(year, 9, 31) }, // Oct 31 (Q3)
      { q: 4, date: new Date(year + 1, 0, 31) }, // Jan 31 (Q4 of this year)
    ];

    for (const { q, date } of quarterDue) {
      const periodStart =
        q === 4 ? new Date(year, 9, 1) : new Date(year, (q - 1) * 3, 1);
      const periodEnd =
        q === 4 ? new Date(year, 11, 31) : new Date(year, q * 3, 0);
      const filed = await this.hasCompletedRuns(companyId, periodStart, periodEnd);
      events.push({
        date: date.toISOString().slice(0, 10),
        form: '941',
        title: `Form 941 — Q${q} ${year} quarterly federal tax return`,
        period: `${periodStart.toISOString().slice(0, 10)} → ${periodEnd.toISOString().slice(0, 10)}`,
        status: filed ? 'simulated_filed' : date < today ? 'overdue' : 'upcoming',
        due: true,
      });
      events.push({
        date: date.toISOString().slice(0, 10),
        form: 'SUTA',
        title: `SUTA — Q${q} ${year} state unemployment report`,
        period: `Q${q} ${year}`,
        status: filed ? 'simulated_filed' : date < today ? 'overdue' : 'upcoming',
        due: true,
      });
      void dayAfter;
    }

    const w2Date = new Date(year + 1, 0, 31);
    const w2Filed = await this.hasCompletedRuns(
      companyId,
      new Date(year, 0, 1),
      new Date(year, 11, 31),
    );
    events.push({
      date: w2Date.toISOString().slice(0, 10),
      form: 'W-2',
      title: `Form W-2 — ${year} wage & tax statements`,
      period: `Calendar year ${year}`,
      status: w2Filed ? 'simulated_filed' : w2Date < today ? 'overdue' : 'upcoming',
      due: true,
    });

    return events.sort((a, b) => a.date.localeCompare(b.date));
  }

  private async hasCompletedRuns(companyId: string, start: Date, end: Date) {
    const count = await this.prisma.payrollRun.count({
      where: {
        companyId,
        status: 'COMPLETED',
        payPeriodStart: { gte: start },
        payPeriodEnd: { lte: end },
      },
    });
    return count > 0;
  }

  /**
   * Jurisdiction rules engine — work state vs residence state with
   * reciprocal-agreement flags (drives withholding expectations).
   */
  async jurisdictionCheck(companyId: string) {
    const employees = await this.prisma.employee.findMany({
      where: { companyId, status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        workState: true,
        residenceState: true,
        residenceCity: true,
      },
      orderBy: { name: 'asc' },
    });
    const cross = employees.filter((e) => e.workState !== e.residenceState);
    const { isReciprocal, getStateConfig } = await import('../tax-engine/states');
    return {
      summary: {
        totalActive: employees.length,
        crossState: cross.length,
        reciprocal: cross.filter((e) => isReciprocal(e.workState, e.residenceState)).length,
        nonReciprocal: cross.filter((e) => !isReciprocal(e.workState, e.residenceState)).length,
        nycResidents: employees.filter(
          (e) => e.residenceState === 'NY' && (e.residenceCity ?? '').toLowerCase() === 'new york',
        ).length,
      },
      employees: cross.map((e) => {
        const reciprocal = isReciprocal(e.workState, e.residenceState);
        const workCfg = getStateConfig(e.workState);
        const resCfg = getStateConfig(e.residenceState);
        return {
          ...e,
          reciprocal,
          workStateTaxes: workCfg ? workCfg.type !== 'none' : false,
          residenceStateTaxes: resCfg ? resCfg.type !== 'none' : false,
          note: reciprocal
            ? `Reciprocal: withheld by residence state ${e.residenceState}`
            : workCfg && workCfg.type !== 'none'
              ? `Source rule: ${e.workState} withholds; ${e.residenceState} credit may apply`
              : resCfg && resCfg.type !== 'none'
                ? `${e.workState} has no income tax; ${e.residenceState} taxes residents`
                : `No configured income tax in either state`,
        };
      }),
    };
  }

  private async aggregateRuns(companyId: string, start: Date, end: Date) {
    const runs = await this.prisma.payrollRun.findMany({
      where: {
        companyId,
        status: 'COMPLETED',
        payPeriodStart: { gte: start },
        payPeriodEnd: { lte: end },
      },
      include: { lineItems: true },
    });
    const totals = {
      wages: 0,
      federal: 0,
      ficaSs: 0,
      ficaMedicare: 0,
      stateTax: 0,
      net: 0,
      runs: runs.length,
    };
    for (const run of runs) {
      for (const l of run.lineItems) {
        totals.wages += l.grossPay;
        totals.federal += l.federalTax;
        totals.ficaSs += l.ficaSs;
        totals.ficaMedicare += l.ficaMedicare;
        totals.stateTax += l.stateTax;
        totals.net += l.netPay;
      }
    }
    return totals;
  }

  /** Watermarked Form 941 mockup from real ledger/payroll data. */
  async form941(companyId: string, periodStartIso: string, periodEndIso: string) {
    const start = new Date(periodStartIso);
    const end = new Date(periodEndIso);
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const t = await this.aggregateRuns(companyId, start, end);
    const q = this.quarterOf(end.getMonth());
    return this.pdf.buildForm941({
      companyName: company.name,
      ein: company.ein,
      periodLabel: `Q${q} ${end.getFullYear()} (SIMULATED)`,
      wages: t.wages,
      federalTax: t.federal,
      socialSecurity: t.ficaSs,
      medicare: t.ficaMedicare,
      employerSocialSecurity: t.ficaSs,
      employerMedicare: t.ficaMedicare,
    });
  }

  /** Watermarked Form W-2 mockup for one employee. */
  async formW2(companyId: string, employeeId: string, year: number) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });

    const agg = await this.prisma.payrollLineItem.aggregate({
      where: {
        employeeId,
        payrollRun: {
          companyId,
          status: 'COMPLETED',
          payPeriodEnd: { gte: new Date(year, 0, 1), lte: new Date(year, 11, 31, 23, 59, 59) },
        },
      },
      _sum: {
        grossPay: true,
        federalTax: true,
        ficaSs: true,
        ficaMedicare: true,
        stateTax: true,
        netPay: true,
      },
    });

    return this.pdf.buildFormW2({
      companyName: company.name,
      ein: company.ein,
      employeeName: employee.name,
      employeeId: employee.id,
      year: String(year),
      wages: agg._sum.grossPay ?? 0,
      federalTax: agg._sum.federalTax ?? 0,
      socialSecurity: agg._sum.ficaSs ?? 0,
      medicare: agg._sum.ficaMedicare ?? 0,
      stateTax: agg._sum.stateTax ?? 0,
      state: employee.workState,
      net: agg._sum.netPay ?? 0,
    });
  }

  /** Watermarked SUTA mockup: state wages × simulated experience rate. */
  async formSuta(companyId: string, year: number, quarter: number, stateOverride?: string) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const state = (stateOverride ?? company.defaultState).toUpperCase();
    const monthStart = (quarter - 1) * 3;
    const start = new Date(year, monthStart, 1);
    const end = new Date(year, monthStart + 3, 0, 23, 59, 59);

    const lines = await this.prisma.payrollLineItem.findMany({
      where: {
        payrollRun: { companyId, status: 'COMPLETED', payPeriodStart: { gte: start }, payPeriodEnd: { lte: end } },
        employee: { workState: state },
      },
      select: { grossPay: true, employeeId: true },
    });

    const byEmployee = new Map<string, number>();
    let totalWages = 0;
    for (const l of lines) {
      totalWages += l.grossPay;
      byEmployee.set(l.employeeId, (byEmployee.get(l.employeeId) ?? 0) + l.grossPay);
    }
    let taxable = 0;
    for (const [, wages] of byEmployee) taxable += Math.min(wages, SUTA_WAGE_BASE_CENTS);
    const tax = Math.round((taxable * SUTA_RATE_BPS) / 10_000);

    return this.pdf.buildSuta({
      companyName: company.name,
      ein: company.ein,
      state,
      periodLabel: `Q${quarter} ${year} (SIMULATED)`,
      taxableWages: taxable,
      totalWages,
      rateBps: SUTA_RATE_BPS,
      wageBase: SUTA_WAGE_BASE_CENTS,
      tax,
    });
  }

  /** Payroll config sanity: frequencies supported by the engine. */
  supportedFrequencies(): Array<{ frequency: PayFrequency; periodsPerYear: number }> {
    return (Object.keys(PERIODS_PER_YEAR) as PayFrequency[]).map((frequency) => ({
      frequency,
      periodsPerYear: PERIODS_PER_YEAR[frequency],
    }));
  }
}
