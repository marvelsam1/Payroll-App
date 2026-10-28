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

/** Poll until `check` returns a truthy value or throw after `timeoutMs`. */
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
 * Payroll lifecycle + ACH state machine integration tests:
 * preview → draft → submit → approve → process → COMPLETED, idempotent
 * processing, negative-net 422, pay stub PDFs, cross-tenant isolation,
 * async ACH settlement, chaos-mode failure codes R01/R02/R03, retry,
 * ledger invariants throughout, and role-aware dashboards.
 */
describe('Payroll run engine + simulated ACH', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: LedgerService;

  let company: { id: string };
  let admin: TestUser;
  let accountant: TestUser;
  let hr: TestUser;
  let adminB: TestUser;
  let tokenAdmin: string;
  let tokenAccountant: string;
  let tokenHr: string;
  let tokenB: string;

  let empAId = '';
  let empBId = '';
  let tokenEmpA = '';
  let tokenEmpB = '';

  const http = () => request(app.getHttpServer());

  const period = (s: string, e: string) => ({ periodStart: s, periodEnd: e });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    ledger = app.get(LedgerService);
    await resetDb();

    company = await createCompany(prisma, { name: 'Acme Logistics', defaultState: 'CA' });
    const companyB = await createCompany(prisma, { name: 'Beta Studios', defaultState: 'TX' });
    await ledger.ensureCompanyAccounts(company.id);
    await ledger.ensureCompanyAccounts(companyB.id);

    admin = await createUser(prisma, { email: 'admin@acme.test', role: Role.COMPANY_ADMIN, companyId: company.id });
    accountant = await createUser(prisma, { email: 'acct@acme.test', role: Role.ACCOUNTANT, companyId: company.id });
    hr = await createUser(prisma, { email: 'hr@acme.test', role: Role.HR_MANAGER, companyId: company.id });
    adminB = await createUser(prisma, { email: 'admin@beta.test', role: Role.COMPANY_ADMIN, companyId: companyB.id });

    tokenAdmin = await login(app, admin.email, admin.password);
    tokenAccountant = await login(app, accountant.email, accountant.password);
    tokenHr = await login(app, hr.email, hr.password);
    tokenB = await login(app, adminB.email, adminB.password);

    const ava = await http()
      .post('/api/v1/employees')
      .set(auth(tokenAdmin))
      .send({
        name: 'Ava Chen',
        email: 'ava@acme.test',
        ssn: '111111111',
        workState: 'CA',
        residenceState: 'CA',
        residenceCity: 'San Francisco',
        payType: 'SALARIED',
        payRateCents: 4_000_000,
        createUser: true,
        password: 'Password123!',
      });
    expect(ava.status).toBe(201);
    empAId = ava.body.id;

    const ben = await http()
      .post('/api/v1/employees')
      .set(auth(tokenAdmin))
      .send({
        name: 'Ben Ortiz',
        email: 'ben@acme.test',
        ssn: '222222222',
        workState: 'TX',
        residenceState: 'TX',
        payType: 'SALARIED',
        payRateCents: 200_000,
        createUser: true,
        password: 'Password123!',
      });
    expect(ben.status).toBe(201);
    empBId = ben.body.id;

    tokenEmpA = await login(app, 'ava@acme.test', 'Password123!');
    tokenEmpB = await login(app, 'ben@acme.test', 'Password123!');
  });

  afterAll(async () => {
    await app.close();
  });

  let runId = '';

  it('previews a payroll period with engine-computed lines and no negative net', async () => {
    const res = await http()
      .post('/api/v1/payroll/preview')
      .set(auth(tokenAdmin))
      .send(period('2026-01-01', '2026-01-14'));
    expect(res.status).toBe(200);
    expect(res.body.lines).toHaveLength(2);
    expect(res.body.frequency).toBe('BIWEEKLY');
    expect(res.body.hasNegativeNet).toBe(false);
    // SALARIED payRate is annual → per-biweekly-period gross
    expect(res.body.totals.grossPay).toBe(
      Math.round(4_000_000 / 26) + Math.round(200_000 / 26),
    );
    // CA employee has state tax, TX employee does not
    const ava = res.body.lines.find((l: any) => l.employeeId === empAId);
    const ben = res.body.lines.find((l: any) => l.employeeId === empBId);
    expect(ava.stateTax).toBeGreaterThan(0);
    expect(ben.stateTax).toBe(0);
    expect(ava.federalTax).toBeGreaterThan(0);
    expect(ava.netPay).toBeGreaterThan(0);
  });

  it('enforces RBAC on payroll routes (accountant read-only, employee no access)', async () => {
    // Accountant has payroll:read → preview allowed, but no create/approve/process
    const acctPreview = await http()
      .post('/api/v1/payroll/preview')
      .set(auth(tokenAccountant))
      .send(period('2026-01-01', '2026-01-14'));
    expect(acctPreview.status).toBe(200);

    const acctCreate = await http()
      .post('/api/v1/payroll/runs')
      .set(auth(tokenAccountant))
      .send(period('2026-01-01', '2026-01-14'));
    expect(acctCreate.status).toBe(403);

    const acctList = await http().get('/api/v1/payroll/runs').set(auth(tokenAccountant));
    expect(acctList.status).toBe(200);

    const emp = await http().get('/api/v1/payroll/runs').set(auth(tokenEmpA));
    expect(emp.status).toBe(403);

    const unauth = await http().get('/api/v1/payroll/runs');
    expect(unauth.status).toBe(401);
  });

  it('runs the full lifecycle DRAFT → PENDING_APPROVAL → APPROVED → PROCESSING → COMPLETED', async () => {
    const created = await http()
      .post('/api/v1/payroll/runs')
      .set(auth(tokenAdmin))
      .send(period('2026-01-01', '2026-01-14'));
    expect(created.status).toBe(201);
    runId = created.body.id;
    expect(created.body.status).toBe('DRAFT');
    expect(created.body.lineItems).toHaveLength(2);

    const submit = await http().post(`/api/v1/payroll/runs/${runId}/submit`).set(auth(tokenAdmin));
    expect(submit.status).toBe(201);
    expect(submit.body.status).toBe('PENDING_APPROVAL');

    // HR manager has payroll:read but not payroll:approve
    const hrApprove = await http().post(`/api/v1/payroll/runs/${runId}/approve`).set(auth(tokenHr));
    expect(hrApprove.status).toBe(403);

    const approve = await http().post(`/api/v1/payroll/runs/${runId}/approve`).set(auth(tokenAdmin));
    expect(approve.status).toBe(201);
    expect(approve.body.status).toBe('APPROVED');

    const process1 = await http().post(`/api/v1/payroll/runs/${runId}/process`).set(auth(tokenAdmin));
    expect(process1.status).toBe(201);
    expect(process1.body.alreadyProcessed).toBe(false);
    expect(process1.body.run.status).toBe('PROCESSING');

    // Idempotency: a second process call must not duplicate work
    const process2 = await http().post(`/api/v1/payroll/runs/${runId}/process`).set(auth(tokenAdmin));
    expect(process2.status).toBe(201);
    expect(process2.body.alreadyProcessed).toBe(true);

    const done = await until(async () => {
      const res = await http().get(`/api/v1/payroll/runs/${runId}`).set(auth(tokenAdmin));
      return res.body.status === 'COMPLETED' ? res.body : null;
    });
    expect(done.journalTxnId).toBeTruthy();
    expect(done.lineItems).toHaveLength(2);
  });

  it('posts a balanced accrual journal and one ACH transfer per employee that settles', async () => {
    const validate = await http().get('/api/v1/ledger/validate').set(auth(tokenAdmin));
    expect(validate.status).toBe(200);
    expect(validate.body.ok).toBe(true);

    const transfers = await http()
      .get(`/api/v1/transfers?payrollRunId=${runId}`)
      .set(auth(tokenAdmin));
    expect(transfers.status).toBe(200);
    expect(transfers.body.items).toHaveLength(2);

    // chaos mode is off → all transfers must settle
    const settled = await until(async () => {
      const res = await http().get(`/api/v1/transfers?payrollRunId=${runId}`).set(auth(tokenAdmin));
      const terminal =
        res.body.items.length === 2 && res.body.items.every((t: any) => t.status === 'SETTLED');
      return terminal ? res.body.items : null;
    });
    for (const t of settled) {
      expect(t.settledAt).toBeTruthy();
      expect(t.failureCode).toBeNull();
    }

    const validateAfter = await http().get('/api/v1/ledger/validate').set(auth(tokenAdmin));
    expect(validateAfter.body.ok).toBe(true);

    const tb = await http().get('/api/v1/ledger/trial-balance').set(auth(tokenAdmin));
    expect(tb.body.balanced).toBe(true);
    expect(tb.body.totalDebits).toBe(tb.body.totalCredits);
  });

  it('serves an admin pay stub PDF and scoped employee pay stubs', async () => {
    const stub = await http()
      .get(`/api/v1/payroll/runs/${runId}/stubs/${empAId}/pdf`)
      .set(auth(tokenAdmin));
    expect(stub.status).toBe(200);
    expect(stub.headers['content-type']).toContain('application/pdf');
    expect(stub.body.subarray(0, 5).toString()).toBe('%PDF-');

    // Own stubs list works for the employee
    const mine = await http().get('/api/v1/payroll/my-paystubs').set(auth(tokenEmpA));
    expect(mine.status).toBe(200);
    expect(Array.isArray(mine.body)).toBe(true);
    expect(mine.body.length).toBeGreaterThanOrEqual(1);
    expect(mine.body[0].netPay).toBeGreaterThan(0);

    // Another employee's stub is denied
    const crossStub = await http()
      .get(`/api/v1/payroll/runs/${runId}/stubs/${empAId}/pdf`)
      .set(auth(tokenEmpB));
    expect(crossStub.status).toBeGreaterThanOrEqual(400);
  });

  it('denies cross-tenant payroll access (tenant scoping from JWT)', async () => {
    const get = await http().get(`/api/v1/payroll/runs/${runId}`).set(auth(tokenB));
    expect(get.status).toBe(404);

    const approve = await http().post(`/api/v1/payroll/runs/${runId}/approve`).set(auth(tokenB));
    expect(approve.status).toBe(404);

    const stub = await http()
      .get(`/api/v1/payroll/runs/${runId}/stubs/${empAId}/pdf`)
      .set(auth(tokenB));
    expect(stub.status).toBeGreaterThanOrEqual(400);
  });

  it('blocks negative net pay at submit with 422 and keeps the run draftable', async () => {
    // Deductions far exceeding gross → negative net
    const nia = await http()
      .post('/api/v1/employees')
      .set(auth(tokenAdmin))
      .send({
        name: 'Nia Fox',
        email: 'nia@acme.test',
        ssn: '333333333',
        workState: 'CA',
        residenceState: 'CA',
        payType: 'SALARIED',
        payRateCents: 100_000,
        garnishmentCents: 50_000_000,
      });
    expect(nia.status).toBe(201);

    const preview = await http()
      .post('/api/v1/payroll/preview')
      .set(auth(tokenAdmin))
      .send(period('2026-02-01', '2026-02-14'));
    expect(preview.body.hasNegativeNet).toBe(true);
    expect(preview.body.negatives.length).toBeGreaterThanOrEqual(1);

    const draft = await http()
      .post('/api/v1/payroll/runs')
      .set(auth(tokenAdmin))
      .send(period('2026-02-01', '2026-02-14'));
    expect(draft.status).toBe(201);

    const submit = await http()
      .post(`/api/v1/payroll/runs/${draft.body.id}/submit`)
      .set(auth(tokenAdmin));
    expect(submit.status).toBe(422);
    expect(submit.body.message).toContain('negative net');

    // still a draft — nothing was pushed forward
    const check = await http().get(`/api/v1/payroll/runs/${draft.body.id}`).set(auth(tokenAdmin));
    expect(check.body.status).toBe('DRAFT');

    // Terminate the negative-net employee so later runs are unaffected
    const term = await http()
      .patch(`/api/v1/employees/${nia.body.id}`)
      .set(auth(tokenAdmin))
      .send({ status: 'TERMINATED' });
    expect(term.status).toBe(200);
  });

  it('injects ACH failure codes R01/R02/R03 under chaos mode and allows retry', async () => {
    const chaos = await http()
      .post('/api/v1/companies/me/chaos-mode')
      .set(auth(tokenAdmin))
      .send({ enabled: true });
    expect(chaos.status).toBe(201);
    expect(chaos.body.chaosMode).toBe(true);

    const draft = await http()
      .post('/api/v1/payroll/runs')
      .set(auth(tokenAdmin))
      .send(period('2026-03-01', '2026-03-14'));
    expect(draft.status).toBe(201);
    const chaosRunId = draft.body.id;
    await http().post(`/api/v1/payroll/runs/${chaosRunId}/submit`).set(auth(tokenAdmin));
    await http().post(`/api/v1/payroll/runs/${chaosRunId}/approve`).set(auth(tokenAdmin));
    await http().post(`/api/v1/payroll/runs/${chaosRunId}/process`).set(auth(tokenAdmin));

    const failed = await until(async () => {
      const res = await http().get(`/api/v1/transfers?payrollRunId=${chaosRunId}`).set(auth(tokenAdmin));
      return res.body.items.length === 2 && res.body.items.every((t: any) => t.status === 'FAILED')
        ? res.body.items
        : null;
    });
    expect(failed).toHaveLength(2);
    for (const t of failed) {
      expect(['R01', 'R02', 'R03']).toContain(t.failureCode);
    }

    // Failed transfers reversed their initiation — ledger invariants hold
    const validate = await http().get('/api/v1/ledger/validate').set(auth(tokenAdmin));
    expect(validate.body.ok).toBe(true);

    // Failure code catalogue is exposed for the UI
    const codes = await http().get('/api/v1/transfers/failure-codes').set(auth(tokenAdmin));
    expect(codes.status).toBe(200);
    expect(codes.body.map((c: any) => c.code).sort()).toEqual(['R01', 'R02', 'R03']);
    expect(codes.body.find((c: any) => c.code === 'R01').meaning).toContain('Insufficient funds');

    // Retry creates a NEW transfer attempt (old one stays FAILED)
    const retry = await http()
      .post(`/api/v1/transfers/${failed[0].id}/retry`)
      .set(auth(tokenAdmin))
      .send({ reason: 'test retry' });
    expect(retry.status).toBe(201);
    expect(retry.body.id).not.toBe(failed[0].id);
    expect(retry.body.attempt).toBe(2);

    // Terminal state on retry (chaos still on, so it may fail again)
    await until(async () => {
      const res = await http().get(`/api/v1/transfers/${retry.body.id}`).set(auth(tokenAdmin));
      return ['SETTLED', 'FAILED'].includes(res.body.status) ? true : null;
    });

    const validateAfter = await http().get('/api/v1/ledger/validate').set(auth(tokenAdmin));
    expect(validateAfter.body.ok).toBe(true);

    // turn chaos back off for any later runs
    await http().post('/api/v1/companies/me/chaos-mode').set(auth(tokenAdmin)).send({ enabled: false });
  });

  it('rejects invalid run state transitions', async () => {
    const reSubmit = await http().post(`/api/v1/payroll/runs/${runId}/submit`).set(auth(tokenAdmin));
    expect(reSubmit.status).toBe(400); // already COMPLETED

    const approveAgain = await http().post(`/api/v1/payroll/runs/${runId}/approve`).set(auth(tokenAdmin));
    expect(approveAgain.status).toBe(400);
  });

  it('serves role-aware dashboards: finance, employee, HR', async () => {
    const fin = await http().get('/api/v1/dashboard').set(auth(tokenAdmin));
    expect(fin.status).toBe(200);
    expect(fin.body.variant).toBe('finance');
    expect(fin.body.kpis.headcount).toBe(2);
    expect(fin.body.kpis.ytdPayrollCostCents).toBeGreaterThan(0);
    expect(fin.body.kpis.nextPayroll).toBeTruthy();
    expect(Array.isArray(fin.body.cashflow)).toBe(true);
    expect(fin.body.cashflow.length).toBeGreaterThanOrEqual(10);

    const emp = await http().get('/api/v1/dashboard').set(auth(tokenEmpA));
    expect(emp.status).toBe(200);
    expect(emp.body.variant).toBe('employee');
    expect(emp.body.kpis.ytdGrossCents).toBeGreaterThan(0);
    expect(emp.body.series.length).toBeGreaterThanOrEqual(1);

    const hrDash = await http().get('/api/v1/dashboard').set(auth(tokenHr));
    expect(hrDash.status).toBe(200);
    expect(hrDash.body.variant).toBe('hr');
    expect(hrDash.body.kpis.headcount).toBe(2);
    // HR must not receive ledger-derived financial widgets
    expect(hrDash.body.kpis.cashBalanceCents).toBeUndefined();
    expect(hrDash.body.cashflow).toBeUndefined();
  });
});
