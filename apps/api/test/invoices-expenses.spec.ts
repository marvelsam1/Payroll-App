import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  auth,
  createCompany,
  createTestApp,
  createUser,
  login,
  resetDb,
  TestUser,
} from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { Role } from '../src/generated/client';

jest.setTimeout(30_000);

async function until<T>(
  check: () => Promise<T | null | undefined | false>,
  timeoutMs = 8000,
  stepMs = 60,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

/**
 * Phase 3: contractor invoices (submit → approve w/ journal → pay-batch ACH)
 * and employee expenses (budgets, approval journals, reimbursements).
 */
describe('Contractor invoices + employee expenses', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: LedgerService;

  let company: { id: string };
  let admin: TestUser;
  let accountant: TestUser;
  let tokenAdmin: string;
  let tokenAccountant: string;
  let tokenContractor = '';
  let tokenEmployee = '';
  let contractorId = '';
  let departmentId = '';
  let employeeUserId = '';

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    ledger = app.get(LedgerService);
    await resetDb();

    company = await createCompany(prisma, { name: 'Invoice Co', defaultState: 'CA' });
    await ledger.ensureCompanyAccounts(company.id);

    admin = await createUser(prisma, { email: 'admin@inv.test', role: Role.COMPANY_ADMIN, companyId: company.id });
    accountant = await createUser(prisma, { email: 'acct@inv.test', role: Role.ACCOUNTANT, companyId: company.id });
    tokenAdmin = await login(app, admin.email, admin.password);
    tokenAccountant = await login(app, accountant.email, accountant.password);

    const dept = await http()
      .post('/api/v1/departments')
      .set(auth(tokenAdmin))
      .send({ name: 'Design', budgetCents: 1_000_000 });
    expect(dept.status).toBe(201);
    departmentId = dept.body.id;

    const contractor = await http()
      .post('/api/v1/contractors')
      .set(auth(tokenAdmin))
      .send({
        name: 'Dana Fields',
        businessName: 'Fields Design LLC',
        email: 'dana@fields.test',
        createUser: true,
        password: 'Password123!',
        paymentTerms: 'Net 14',
      });
    expect(contractor.status).toBe(201);
    contractorId = contractor.body.id;
    tokenContractor = await login(app, 'dana@fields.test', 'Password123!');

    const employee = await http()
      .post('/api/v1/employees')
      .set(auth(tokenAdmin))
      .send({
        name: 'Evan Rosa',
        email: 'evan@inv.test',
        ssn: '444444444',
        workState: 'CA',
        residenceState: 'CA',
        payType: 'SALARIED',
        payRateCents: 3_000_000,
        departmentId,
        createUser: true,
        password: 'Password123!',
      });
    expect(employee.status).toBe(201);
    tokenEmployee = await login(app, 'evan@inv.test', 'Password123!');
    const empUser = await prisma.user.findUnique({ where: { id: employee.body.userId ?? '' } });
    employeeUserId = empUser?.id ?? '';
    if (!employee.body.userId) {
      const u = await prisma.user.findFirst({ where: { email: 'evan@inv.test' } });
      employeeUserId = u!.id;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Invoices
  // -------------------------------------------------------------------------
  let invoiceId = '';

  it('contractor submits an invoice; RBAC gates submission and approval', async () => {
    const employeeSubmit = await http()
      .post('/api/v1/invoices')
      .set(auth(tokenEmployee))
      .send({
        description: 'Should not work',
        amountCents: 1000,
        periodStart: '2026-04-01',
        periodEnd: '2026-04-15',
      });
    expect(employeeSubmit.status).toBe(403);

    const res = await http()
      .post('/api/v1/invoices')
      .set(auth(tokenContractor))
      .send({
        description: 'Landing page illustrations',
        amountCents: 250_000,
        periodStart: '2026-04-01',
        periodEnd: '2026-04-15',
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('SUBMITTED');
    expect(res.body.contractorId).toBe(contractorId);
    invoiceId = res.body.id;

    // Accountant: read-only on invoices
    const acctList = await http().get('/api/v1/invoices').set(auth(tokenAccountant));
    expect(acctList.status).toBe(200);
    const acctApprove = await http().post(`/api/v1/invoices/${invoiceId}/approve`).set(auth(tokenAccountant));
    expect(acctApprove.status).toBe(403);

    // Contractor cannot approve their own invoice
    const selfApprove = await http().post(`/api/v1/invoices/${invoiceId}/approve`).set(auth(tokenContractor));
    expect(selfApprove.status).toBe(403);
  });

  it('admin approves the invoice with a double-entry journal', async () => {
    const approve = await http()
      .post(`/api/v1/invoices/${invoiceId}/approve`)
      .set(auth(tokenAdmin));
    expect(approve.status).toBe(201);
    expect(approve.body.status).toBe('APPROVED');

    const entries = await http()
      .get('/api/v1/ledger/entries?referenceType=invoice')
      .set(auth(tokenAdmin));
    expect(entries.status).toBe(200);
    expect(entries.body.items.length).toBeGreaterThanOrEqual(2);

    const accounts = await http().get('/api/v1/ledger/accounts').set(auth(tokenAdmin));
    const byCode = Object.fromEntries(accounts.body.accounts.map((a: any) => [a.code, a]));
    expect(byCode.CONTRACTOR_EXPENSE.balanceCents).toBe(250_000); // debit-normal
    expect(byCode.CONTRACTOR_PAYABLE.balanceCents).toBe(250_000); // credit-normal shows positive
  });

  it('pay-batch creates ACH transfers that settle and marks the invoice PAID', async () => {
    const batch = await http()
      .post('/api/v1/invoices/pay-batch')
      .set(auth(tokenAdmin))
      .send({ invoiceIds: [invoiceId] });
    expect(batch.status).toBe(201);
    expect(batch.body.results).toHaveLength(1);
    expect(batch.body.results[0].transferId).toBeTruthy();
    expect(batch.body.results[0].error).toBeUndefined();

    const paid = await until(async () => {
      const res = await http().get(`/api/v1/invoices/${invoiceId}`).set(auth(tokenAdmin));
      return res.body.status === 'PAID' ? res.body : null;
    });
    expect(paid.paidAt).toBeTruthy();

    const transfers = await http()
      .get(`/api/v1/transfers?invoiceId=${invoiceId}`)
      .set(auth(tokenAdmin));
    expect(transfers.body.items).toHaveLength(1);
    expect(transfers.body.items[0].status).toBe('SETTLED');

    // payable discharged by settlement
    const validate = await http().get('/api/v1/ledger/validate').set(auth(tokenAdmin));
    expect(validate.body.ok).toBe(true);
  });

  it('admin rejects a second invoice with a reason', async () => {
    const second = await http()
      .post('/api/v1/invoices')
      .set(auth(tokenAdmin))
      .send({
        description: 'Duplicate invoice',
        amountCents: 99_000,
        periodStart: '2026-04-16',
        periodEnd: '2026-04-30',
      });
    expect(second.status).toBe(201);
    const reject = await http()
      .post(`/api/v1/invoices/${second.body.id}/reject`)
      .set(auth(tokenAdmin))
      .send({ reason: 'Scope already covered' });
    expect(reject.status).toBe(201);
    expect(reject.body.status).toBe('REJECTED');
    expect(reject.body.rejectionReason).toContain('Scope already covered');
  });

  it('scopes invoice reads to the tenant', async () => {
    const other = await createCompany(prisma, { name: 'Other Co' });
    await ledger.ensureCompanyAccounts(other.id);
    const otherAdmin = await createUser(prisma, {
      email: 'admin@other.test',
      role: Role.COMPANY_ADMIN,
      companyId: other.id,
    });
    const tokenOther = await login(app, otherAdmin.email, otherAdmin.password);
    const res = await http().get(`/api/v1/invoices/${invoiceId}`).set(auth(tokenOther));
    expect(res.status).toBe(404);
  });

  // -------------------------------------------------------------------------
  // Expenses
  // -------------------------------------------------------------------------
  let expenseId = '';

  it('employee submits an expense against a budget department', async () => {
    const res = await http()
      .post('/api/v1/expenses')
      .set(auth(tokenEmployee))
      .send({
        amountCents: 42_000,
        category: 'Software',
        description: 'Figma annual seat',
        departmentId,
        expenseDate: '2026-05-02',
        reimbursementMode: 'STANDALONE',
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('SUBMITTED');
    expect(res.body.submittedById).toBe(employeeUserId);
    expenseId = res.body.id;
  });

  it('approval is gated (employee/HR no, admin yes) and posts the expense journal', async () => {
    const empApprove = await http()
      .post(`/api/v1/expenses/${expenseId}/approve`)
      .set(auth(tokenEmployee));
    expect(empApprove.status).toBe(403);

    const acctApprove = await http()
      .post(`/api/v1/expenses/${expenseId}/approve`)
      .set(auth(tokenAccountant));
    expect(acctApprove.status).toBe(403);

    const approve = await http()
      .post(`/api/v1/expenses/${expenseId}/approve`)
      .set(auth(tokenAdmin));
    expect(approve.status).toBe(201);
    expect(approve.body.status).toBe('APPROVED');

    const accounts = await http().get('/api/v1/ledger/accounts').set(auth(tokenAdmin));
    const byCode = Object.fromEntries(accounts.body.accounts.map((a: any) => [a.code, a]));
    expect(byCode.REIMBURSABLE_EXPENSE.balanceCents).toBe(42_000);
    expect(byCode.EXPENSE_REIMBURSEMENT_PAYABLE.balanceCents).toBe(42_000); // credit-normal
  });

  it('standalone reimbursement clears the payable and moves cash', async () => {
    const cashBefore = (
      await http().get('/api/v1/ledger/accounts').set(auth(tokenAdmin))
    ).body.accounts.find((a: any) => a.code === 'OPERATING_CASH').balanceCents;

    const reimb = await http()
      .post(`/api/v1/expenses/${expenseId}/reimburse`)
      .set(auth(tokenAdmin));
    expect(reimb.status).toBe(201);
    expect(reimb.body.status).toBe('REIMBURSED');
    expect(reimb.body.reimbursedAt).toBeTruthy();

    const accounts = await http().get('/api/v1/ledger/accounts').set(auth(tokenAdmin));
    const byCode = Object.fromEntries(accounts.body.accounts.map((a: any) => [a.code, a]));
    expect(byCode.EXPENSE_REIMBURSEMENT_PAYABLE.balanceCents).toBe(0);
    expect(byCode.OPERATING_CASH.balanceCents).toBe(cashBefore - 42_000);

    const validate = await http().get('/api/v1/ledger/validate').set(auth(tokenAdmin));
    expect(validate.body.ok).toBe(true);
  });

  it('rejects with a reason and reports budgets/spend on the dashboard', async () => {
    const second = await http()
      .post('/api/v1/expenses')
      .set(auth(tokenEmployee))
      .send({
        amountCents: 15_000,
        category: 'Meals',
        description: 'Team lunch',
        departmentId,
      });
    expect(second.status).toBe(201);

    const reject = await http()
      .post(`/api/v1/expenses/${second.body.id}/reject`)
      .set(auth(tokenAdmin))
      .send({ reason: 'Meals over policy' });
    expect(reject.status).toBe(201);
    expect(reject.body.status).toBe('REJECTED');
    expect(reject.body.rejectionReason).toContain('over policy');

    const dash = await http().get('/api/v1/dashboard').set(auth(tokenAdmin));
    expect(dash.status).toBe(200);
    const design = dash.body.departments.find((d: any) => d.id === departmentId);
    expect(design.budgetCents).toBe(1_000_000);
    expect(design.spentCents).toBe(42_000); // rejected expense not counted
  });

  it('employee sees only their own expenses; admins see all', async () => {
    const mine = await http().get('/api/v1/expenses').set(auth(tokenEmployee));
    expect(mine.status).toBe(200);
    expect(mine.body.items).toHaveLength(2);
    expect(mine.body.items.every((e: any) => e.submittedById === employeeUserId)).toBe(true);

    const all = await http().get('/api/v1/expenses').set(auth(tokenAdmin));
    expect(all.body.total).toBeGreaterThanOrEqual(2);

    const filtered = await http().get('/api/v1/expenses?status=REJECTED').set(auth(tokenAdmin));
    expect(filtered.body.items).toHaveLength(1);
    expect(filtered.body.items[0].status).toBe('REJECTED');
  });

  it('DEFER_TO_PAYROLL expenses stay APPROVED until payroll marks them reimbursed', async () => {
    const defer = await http()
      .post('/api/v1/expenses')
      .set(auth(tokenEmployee))
      .send({
        amountCents: 7_500,
        category: 'Travel',
        description: 'Client visit train fare',
        reimbursementMode: 'DEFER_TO_PAYROLL',
        departmentId,
      });
    expect(defer.status).toBe(201);
    const approve = await http()
      .post(`/api/v1/expenses/${defer.body.id}/approve`)
      .set(auth(tokenAdmin));
    expect(approve.body.status).toBe('APPROVED');
    expect(approve.body.reimbursementMode).toBe('DEFER_TO_PAYROLL');

    // Standalone reimbursement path refuses deferred mode
    const reimb = await http()
      .post(`/api/v1/expenses/${defer.body.id}/reimburse`)
      .set(auth(tokenAdmin));
    expect(reimb.status).toBe(400);
  });
});
