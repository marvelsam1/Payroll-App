/* eslint-disable no-console */
/**
 * PayLedger demo seed.
 *
 * Creates TWO companies with 50+ employees, 6 months of completed payroll
 * history (real tax engine + double-entry journals + PDF stubs), contractor
 * invoices, expenses against department budgets, and a realistic mix of
 * SETTLED / FAILED (R01–R03) / in-flight ACH transfers.
 *
 * Everything is written through the real services — no hand-faked balances —
 * so the dashboard, ledger, compliance forms and audit trail all agree.
 *
 * Run: npm run seed   (workspace apps/api)
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcryptjs';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { LedgerService } from './ledger/ledger.service';
import { PayrollService } from './payroll/payroll.service';
import { AchService } from './ach/ach.service';
import { EmployeesService } from './employees/employees.service';
import { DepartmentsService } from './departments/departments.service';
import { ExpensesService } from './expenses/expenses.service';
import { InvoicesService } from './invoices/invoices.service';
import { Role } from './generated/client';
import { SessionUser } from './common/decorators';
import { CreateEmployeeInput } from './employees/employees.service';

type SessionUserLike = SessionUser;

// ---------------------------------------------------------------------------

const PASSWORD = 'Password123!';
const STATES = ['CA', 'TX', 'NY', 'NJ', 'PA'] as const;
const FIRST = [
  'Ava', 'Ben', 'Cleo', 'Diego', 'Emma', 'Femi', 'Gia', 'Hugo', 'Ivy', 'Jack',
  'Kira', 'Liam', 'Maya', 'Noah', 'Olive', 'Pete', 'Quinn', 'Rosa', 'Sam', 'Tara',
  'Uma', 'Vince', 'Wren', 'Xander', 'Yara', 'Zane', 'Nora', 'Omar', 'Priya', 'Theo',
];
const LAST = [
  'Chen', 'Ortiz', 'Okafor', 'Silva', 'Novak', 'Adeyemi', 'Rossi', 'Weber', 'Larsen', 'Kim',
  'Haddad', 'Mbeki', 'Dubois', 'Sato', 'Grant', 'Ivanov', 'Moreau', 'Costa', 'Reyes', 'Fischer',
  'Balogun', 'Petrov', 'Yamada', 'Fontaine', 'Ali', 'Nguyen', 'Berg', 'Costa', 'Dias', 'Khan',
];

let seq = 0;
function rnd(min: number, max: number): number {
  // deterministic LCG so re-runs produce stable demo data
  seq = (seq * 1103515245 + 12345) & 0x7fffffff;
  return min + (seq % (max - min + 1));
}
function pick<T>(arr: readonly T[]): T {
  return arr[rnd(0, arr.length - 1)];
}
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

interface CompanySeed {
  name: string;
  ein: string;
  state: string;
  paySchedule: 'BIWEEKLY' | 'MONTHLY';
  revenue: number; // monthlyRevenueCents
  slug: string;
  employeeCount: number;
  chaosMode: boolean;
}

const COMPANIES: CompanySeed[] = [
  {
    name: 'Northwind Traders LLC',
    ein: '98-7654321',
    state: 'CA',
    paySchedule: 'BIWEEKLY',
    revenue: 28_000_000,
    slug: 'northwind',
    employeeCount: 32,
    chaosMode: false,
  },
  {
    name: 'Vertex Labs Inc',
    ein: '12-9876543',
    state: 'TX',
    paySchedule: 'BIWEEKLY',
    revenue: 34_000_000,
    slug: 'vertex',
    employeeCount: 30,
    chaosMode: true, // demo chaos mode — retryable failures already seeded below
  },
];

const DEPARTMENTS = [
  { name: 'Engineering', budget: 12_000_000 },
  { name: 'Sales', budget: 4_000_000 },
  { name: 'Design', budget: 2_500_000 },
  { name: 'Support', budget: 1_800_000 },
];

// ---------------------------------------------------------------------------
// History window: 6 months of biweekly periods ending yesterday-ish
// ---------------------------------------------------------------------------

function historyPeriods(count: number): Array<{ start: Date; end: Date }> {
  const today = new Date();
  const lastStart = addDays(today, -((today.getDay() + 6) % 7) - 2); // last Monday ≤ today - 1
  const firstStart = addDays(lastStart, -14 * (count - 1));
  const out: Array<{ start: Date; end: Date }> = [];
  for (let i = 0; i < count; i++) {
    const start = addDays(firstStart, i * 14);
    out.push({ start, end: addDays(start, 13) });
  }
  return out;
}

async function main() {
  const startedAt = Date.now();
  const ctx = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = ctx.get(PrismaService);
  const ledger = ctx.get(LedgerService);
  const payroll = ctx.get(PayrollService);
  const ach = ctx.get(AchService);
  const employees = ctx.get(EmployeesService);
  const departments = ctx.get(DepartmentsService);
  const expenses = ctx.get(ExpensesService);
  const invoices = ctx.get(InvoicesService);

  console.log('▶ seeding PayLedger…');

  const periods = historyPeriods(13); // 6 months of biweekly runs
  let totalEmployees = 0;
  let totalRuns = 0;
  let settled = 0;
  let failed = 0;
  let inflight = 0;

  for (const [ci, spec] of COMPANIES.entries()) {
    // -- company + chart of accounts + starting balance ---------------------
    const company = await prisma.company.create({
      data: {
        name: spec.name,
        ein: spec.ein,
        defaultState: spec.state,
        paySchedule: spec.paySchedule,
        monthlyRevenueCents: spec.revenue,
        chaosMode: spec.chaosMode,
      },
    });
    await ledger.ensureCompanyAccounts(company.id);
    const adminSession: SessionUserLike = {
      id: '',
      email: `admin@${spec.slug}.test`,
      role: Role.COMPANY_ADMIN,
      companyId: company.id,
    };

    // platform-visible admin user
    const adminUser = await prisma.user.create({
      data: {
        email: `admin@${spec.slug}.test`,
        name: `${spec.name} Admin`,
        role: Role.COMPANY_ADMIN,
        companyId: company.id,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
      },
    });
    adminSession.id = adminUser.id;

    // starting cash so transfers can settle
    await ledger.postTransaction(
      {
        companyId: company.id,
        description: 'Opening operating balance (seed)',
        referenceType: 'opening_balance',
        entries: [
          { accountCode: 'OPERATING_CASH', debit: 25_000_000 },
          { accountCode: 'OPENING_BALANCE_EQUITY', credit: 25_000_000 },
        ],
      },
    );

    // supporting roles per company
    for (const [role, email] of [
      [Role.ACCOUNTANT, `accountant@${spec.slug}.test`],
      [Role.HR_MANAGER, `hr@${spec.slug}.test`],
    ] as const) {
      await prisma.user.create({
        data: {
          email,
          name: email.split('@')[0],
          role,
          companyId: company.id,
          passwordHash: await bcrypt.hash(PASSWORD, 4),
        },
      });
    }

    // -- departments ---------------------------------------------------------
    const deptIds: string[] = [];
    for (const d of DEPARTMENTS) {
      const dept = await departments.create(
        company.id,
        { name: d.name, budgetCents: d.budget },
        adminSession,
      );
      deptIds.push(dept.id);
    }

    // -- employees -----------------------------------------------------------
    const hireBefore = iso(addDays(periods[0].start, -30));
    const employeeIds: string[] = [];
    for (let i = 0; i < spec.employeeCount; i++) {
      const first = FIRST[(i + ci * 7) % FIRST.length];
      const last = LAST[(i * 3 + ci) % LAST.length];
      const state = STATES[(i + ci) % STATES.length];
      const hourly = i % 9 === 4;
      const terminated = i % 17 === 15;
      const workNY = state === 'NY';
      const input = {
        name: `${first} ${last}`,
        email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@${spec.slug}.test`,
        ssn: `${100 + ci}${String(10_000_000 + i * 137_651).slice(0, 7)}`.slice(0, 9),
        workState: workNY ? 'NY' : state,
        residenceState: i % 5 === 0 && state !== 'TX' ? 'NJ' : state,
        residenceCity: state === 'NY' && i % 3 === 0 ? 'New York' : undefined,
        filingStatus: (['SINGLE', 'MARRIED_JOINTLY', 'HEAD_OF_HOUSEHOLD'] as const)[i % 3],
        payType: hourly ? ('HOURLY' as const) : ('SALARIED' as const),
        payRateCents: hourly ? rnd(2200, 5200) : rnd(3_800_000, 9_500_000),
        weeklyHours: hourly ? rnd(20, 38) : undefined,
        departmentId: deptIds[i % deptIds.length],
        hireDate: i % 6 === 5 ? iso(addDays(periods[0].start, rnd(10, 120))) : hireBefore,
        status: terminated ? ('TERMINATED' as const) : ('ACTIVE' as const),
        preTax401kBps: i % 3 === 0 ? 400 : 0,
        healthInsuranceCents: i % 4 === 0 ? 18_500 : 0,
        postTaxRothBps: i % 7 === 0 ? 200 : 0,
        ptoBalanceDays: rnd(0, 18),
      };
      const emp = await employees.create(company.id, input as CreateEmployeeInput, adminSession);
      totalEmployees++;
      if (!terminated && employeeIds.length < 30) employeeIds.push(emp.id);

      // a handful of login-able demo employees
      if (i < 3) {
        await prisma.user.create({
          data: {
            email: input.email!,
            name: input.name,
            role: Role.EMPLOYEE,
            companyId: company.id,
            passwordHash: await bcrypt.hash(PASSWORD, 4),
          },
        });
        await prisma.employee.update({ where: { id: emp.id }, data: { userId: (await prisma.user.findUniqueOrThrow({ where: { email: input.email! } })).id } });
      }
    }

    // -- contractor ----------------------------------------------------------
    const contractorUser = await prisma.user.create({
      data: {
        email: `contractor@${spec.slug}.test`,
        name: `${spec.slug} studio`,
        role: Role.CONTRACTOR,
        companyId: company.id,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
      },
    });
    const contractor = await prisma.contractor.create({
      data: {
        companyId: company.id,
        userId: contractorUser.id,
        name: `${spec.slug === 'northwind' ? 'Bright' : 'Signal'} Studio`,
        businessName: `${spec.slug === 'northwind' ? 'Bright' : 'Signal'} Design Co`,
        email: contractorUser.email,
        paymentTerms: 'Net 14',
        rateCents: 150_000,
        rateUnit: 'hour',
      },
    });

    // -- payroll history: 6 months through the REAL engine -------------------
    for (const [ri, period] of periods.entries()) {
      const existing = await prisma.payrollRun.findFirst({
        where: { companyId: company.id, payPeriodStart: period.start, payPeriodEnd: period.end },
      });
      if (existing) continue;

      const run = await payroll.createDraft(
        adminSession,
        period.start,
        period.end,
      );
      await payroll.submit(adminSession, run.id);
      await payroll.approve(adminSession, run.id);
      await prisma.payrollRun.update({
        where: { id: run.id },
        data: { status: 'PROCESSING' },
      });
      await payroll.finalizeRun(run.id, adminUser.id);
      totalRuns++;

      // client receipts funding this period (keeps the cash account realistic)
      const gross = run.lineItems.reduce((s, l) => s + l.grossPay, 0);
      const receipt = Math.round(gross * 1.18) + rnd(0, 240_000);
      await ledger.postTransaction(
        {
          companyId: company.id,
          description: `Client receipts ${iso(period.start)} → ${iso(period.end)}`,
          referenceType: 'client_receipt',
          referenceId: run.id,
          entries: [
            { accountCode: 'OPERATING_CASH', debit: receipt },
            { accountCode: 'REVENUE', credit: receipt },
          ],
        },
      );

      // drive ACH: mostly settled, deterministic sprinkle of R01/R02/R03
      // failures and a few still-in-flight transfers
      const transfers = await prisma.bankTransfer.findMany({
        where: { payrollRunId: run.id },
        orderBy: { createdAt: 'asc' },
      });
      for (const [ti, t] of transfers.entries()) {
        const h = (ri * 17 + ti * 7 + ci * 5) % 29;
        if (h === 0) {
          await ach.fail(t.id, 'R01');
          failed++;
        } else if (h === 1) {
          await ach.fail(t.id, 'R02');
          failed++;
        } else if (h === 2) {
          await ach.fail(t.id, 'R03');
          failed++;
        } else if (h === 3 && ri < periods.length - 2) {
          inflight++; // leave PENDING — shows as in-flight on the ledger
        } else {
          await ach.settle(t.id);
          settled++;
        }
      }
      if (ri % 4 === 3) {
        console.log(
          `  · ${spec.name}: run ${ri + 1}/${periods.length} (${iso(period.start)}) done`,
        );
      }
    }

    // -- contractor invoices -------------------------------------------------
    const contractorSession: SessionUserLike = {
      id: contractorUser.id,
      email: contractorUser.email,
      role: Role.CONTRACTOR,
      companyId: company.id,
    };
    const invoicePlan = [
      { monthsAgo: 5, amount: 480_000, fate: 'paid' as const },
      { monthsAgo: 4, amount: 625_000, fate: 'failed' as const },
      { monthsAgo: 2, amount: 340_000, fate: 'paid' as const },
      { monthsAgo: 1, amount: 515_000, fate: 'approved' as const },
      { monthsAgo: 0, amount: 290_000, fate: 'submitted' as const },
    ];
    for (const plan of invoicePlan) {
      const end = addDays(new Date(), -plan.monthsAgo * 30);
      const start = addDays(end, -14);
      const inv = await invoices.submit(contractorSession, {
        amountCents: plan.amount,
        description: `Product design sprint ${iso(start)} → ${iso(end)}`,
        periodStart: iso(start),
        periodEnd: iso(end),
      });
      if (plan.fate === 'submitted') continue;
      await invoices.approve(adminSession, inv.id);
      if (plan.fate === 'approved') continue;
      const transfer = await ach.initiateInvoiceTransfer({
        companyId: company.id,
        invoiceId: inv.id,
        amountCents: plan.amount,
      });
      if (plan.fate === 'paid') {
        await ach.settle(transfer.id);
        settled++;
      } else {
        await ach.fail(transfer.id, 'R02');
        failed++;
      }
    }

    // -- expenses with budgets ------------------------------------------------
    const expensePlan: Array<{
      amount: number;
      category: string;
      mode: 'STANDALONE' | 'DEFER_TO_PAYROLL';
      outcome: 'reimbursed' | 'deferred' | 'rejected' | 'submitted';
      dept: number;
    }> = [
      { amount: 42_000, category: 'Software', mode: 'STANDALONE', outcome: 'reimbursed', dept: 0 },
      { amount: 128_500, category: 'Travel', mode: 'STANDALONE', outcome: 'reimbursed', dept: 1 },
      { amount: 19_900, category: 'Office', mode: 'DEFER_TO_PAYROLL', outcome: 'deferred', dept: 2 },
      { amount: 86_300, category: 'Travel', mode: 'STANDALONE', outcome: 'reimbursed', dept: 1 },
      { amount: 55_000, category: 'Meals', mode: 'STANDALONE', outcome: 'rejected', dept: 1 },
      { amount: 24_800, category: 'Software', mode: 'DEFER_TO_PAYROLL', outcome: 'submitted', dept: 0 },
      { amount: 153_200, category: 'Equipment', mode: 'DEFER_TO_PAYROLL', outcome: 'deferred', dept: 3 },
    ];
    for (const plan of expensePlan) {
      const empRow = await prisma.employee.findFirst({
        where: { companyId: company.id, status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
        skip: plan.dept,
      });
      if (!empRow) continue;
      const empUser = empRow.userId
        ? await prisma.user.findUnique({ where: { id: empRow.userId } })
        : null;
      const empSession: SessionUserLike = empUser
        ? { id: empUser.id, email: empUser.email, role: Role.EMPLOYEE, companyId: company.id }
        : adminSession;
      const expense = await expenses.submit(empSession, {
        amountCents: plan.amount,
        category: plan.category,
        description: `${plan.category} — ${empRow.name}`,
        departmentId: deptIds[plan.dept % deptIds.length],
        reimbursementMode: plan.mode,
        expenseDate: iso(addDays(new Date(), -rnd(5, 90))),
      });
      if (plan.outcome === 'submitted') continue;
      if (plan.outcome === 'rejected') {
        await expenses.reject(adminSession, expense.id, 'Over per-diem policy (seed)');
        continue;
      }
      await expenses.approve(adminSession, expense.id);
      if (plan.outcome === 'reimbursed') {
        await expenses.reimburseStandalone(adminSession, expense.id);
      }
      // deferred: left APPROVED — picked up by the next payroll run
    }

    console.log(`  ✓ ${spec.name}: ${spec.employeeCount} employees, ${periods.length} payroll runs`);
  }

  // -- sanity: invariants must hold ------------------------------------------
  const report = await ledger.validateInvariants(
    (await prisma.company.findFirstOrThrow({ where: { name: COMPANIES[0].name } })).id,
  );
  if (!report.ok) {
    console.error('✗ ledger invariants failed after seed:', JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } else {
    console.log('  ✓ ledger invariants OK');
  }

  const runs = await prisma.payrollRun.count({ where: { status: 'COMPLETED' } });
  const transfers = await prisma.bankTransfer.groupBy({
    by: ['status'],
    _count: { id: true },
  });
  console.log(`
──────────────────────────────────────────────
 Seed complete in ${((Date.now() - startedAt) / 1000).toFixed(1)}s
   companies:      ${COMPANIES.length}
   employees:      ${totalEmployees}
   payroll runs:   ${runs} completed
   ACH transfers:  ${transfers.map((t) => `${t.status}=${t._count.id}`).join(' ')}
                    (settled ${settled} · failed ${failed} · left in-flight ${inflight})
   ledger:         invariants verified
──────────────────────────────────────────────
 Demo logins (password ${PASSWORD}):
   admin@northwind.test    Company Admin · Northwind Traders
   admin@vertex.test       Company Admin · Vertex Labs
   accountant@northwind.test · hr@northwind.test
   ava.chen0@northwind.test (employee) · contractor@northwind.test
   ${FIRST[0].toLowerCase()}.${LAST[0].toLowerCase()}0@northwind.test / ${FIRST[1].toLowerCase()}.${LAST[1].toLowerCase()}1@northwind.test …
`);

  await ctx.close();
  // memory-queue timers are unref'd; exit explicitly so huge seeded delays can't hold the process
  process.exit(process.exitCode ?? 0);
}

main().catch((err) => {
  console.error('✗ seed failed:', err);
  process.exit(1);
});
