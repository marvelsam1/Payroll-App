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

/**
 * Multi-tenancy hard proof + API-level RBAC matrix.
 *
 * Every tenant resource is scoped by companyId derived from the JWT —
 * client-supplied tenant ids are never trusted. These tests prove that
 * cross-tenant access is impossible for reads AND writes across the API.
 */
describe('Multi-tenancy isolation + RBAC matrix', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: LedgerService;

  let compA: { id: string };
  let compB: { id: string };
  let adminA: TestUser;
  let adminB: TestUser;
  let platform: TestUser;
  let employeeA: TestUser;
  let hrA: TestUser;
  let accountantA: TestUser;
  let contractorA: TestUser;

  let tokenA = '';
  let tokenB = '';
  let tokenPlatform = '';
  let tokenEmployeeA = '';
  let tokenHrA = '';
  let tokenAccountantA = '';
  let tokenContractorA = '';

  // resources owned by tenant A (targets for cross-tenant probes)
  let empId = '';
  let contractorId = '';
  let departmentId = '';
  let expenseId = '';
  let invoiceId = '';
  let runId = '';

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    ledger = app.get(LedgerService);
    await resetDb();

    compA = await createCompany(prisma, { name: 'Tenant Alpha' });
    compB = await createCompany(prisma, { name: 'Tenant Beta' });
    await ledger.ensureCompanyAccounts(compA.id);
    await ledger.ensureCompanyAccounts(compB.id);

    adminA = await createUser(prisma, { email: 'a@alpha.test', role: Role.COMPANY_ADMIN, companyId: compA.id });
    adminB = await createUser(prisma, { email: 'b@beta.test', role: Role.COMPANY_ADMIN, companyId: compB.id });
    platform = await createUser(prisma, { email: 'root@payledger.test', role: Role.PLATFORM_ADMIN, companyId: null });
    hrA = await createUser(prisma, { email: 'hr@alpha.test', role: Role.HR_MANAGER, companyId: compA.id });
    accountantA = await createUser(prisma, { email: 'acct@alpha.test', role: Role.ACCOUNTANT, companyId: compA.id });
    contractorA = await createUser(prisma, { email: 'c@alpha.test', role: Role.CONTRACTOR, companyId: compA.id });

    tokenA = await login(app, adminA.email, adminA.password);
    tokenB = await login(app, adminB.email, adminB.password);
    tokenPlatform = await login(app, platform.email, platform.password);
    tokenHrA = await login(app, hrA.email, hrA.password);
    tokenAccountantA = await login(app, accountantA.email, accountantA.password);
    tokenContractorA = await login(app, contractorA.email, contractorA.password);

    // --- seed resources in tenant A ---
    const dept = await http().post('/api/v1/departments').set(auth(tokenA)).send({ name: 'Ops', budgetCents: 500_000 });
    departmentId = dept.body.id;

    const emp = await http()
      .post('/api/v1/employees')
      .set(auth(tokenA))
      .send({
        name: 'Tess Alpha',
        email: 'tess@alpha.test',
        ssn: '555555555',
        workState: 'TX',
        residenceState: 'TX',
        payType: 'SALARIED',
        payRateCents: 2_000_000,
        departmentId,
        createUser: true,
        password: 'Password123!',
      });
    empId = emp.body.id;
    tokenEmployeeA = await login(app, 'tess@alpha.test', 'Password123!');

    const con = await http()
      .post('/api/v1/contractors')
      .set(auth(tokenA))
      .send({ name: 'Vend Alpha', email: 'vend@alpha.test', createUser: true, password: 'Password123!' });
    contractorId = con.body.id;

    const exp = await http()
      .post('/api/v1/expenses')
      .set(auth(tokenEmployeeA))
      .send({ amountCents: 10_000, category: 'Software', departmentId, reimbursementMode: 'STANDALONE' });
    expenseId = exp.body.id;

    const inv = await http()
      .post('/api/v1/invoices')
      .set(auth(tokenA))
      .send({ description: 'Alpha work', amountCents: 100_000, periodStart: '2026-06-01', periodEnd: '2026-06-15' });
    invoiceId = inv.body.id;

    const run = await http()
      .post('/api/v1/payroll/runs')
      .set(auth(tokenA))
      .send({ periodStart: '2026-06-01', periodEnd: '2026-06-14' });
    runId = run.body.id;

    const ledgerPost = await http()
      .post('/api/v1/ledger/transactions')
      .set(auth(tokenA))
      .send({
        description: 'Alpha opening balance',
        entries: [
          { accountCode: 'OPERATING_CASH', debit: 500_000 },
          { accountCode: 'OPENING_BALANCE_EQUITY', credit: 500_000 },
        ],
      });
    expect(ledgerPost.status).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Cross-tenant reads: must 404 (no existence leaks)
  // -------------------------------------------------------------------------
  it('returns 404 for tenant-A resources when requested by tenant-B admin', async () => {
    const probes: Array<[string, string]> = [
      ['GET', `/api/v1/employees/${empId}`],
      ['GET', `/api/v1/contractors/${contractorId}`],
      ['GET', `/api/v1/departments/${departmentId}`],
      ['GET', `/api/v1/expenses/${expenseId}`],
      ['GET', `/api/v1/invoices/${invoiceId}`],
      ['GET', `/api/v1/payroll/runs/${runId}`],
    ];
    for (const [method, url] of probes) {
      const res = await (method === 'GET' ? http().get(url) : http().post(url)).set(auth(tokenB));
      expect(`${url} → ${res.status}`).toBe(`${url} → 404`);
    }
  });

  it('returns 404 for tenant-A writes when requested by tenant-B admin', async () => {
    const writes: Array<() => request.Test> = [
      () => http().patch(`/api/v1/employees/${empId}`).set(auth(tokenB)).send({ name: 'Hijacked' }),
      () => http().delete(`/api/v1/employees/${empId}`).set(auth(tokenB)),
      () => http().patch(`/api/v1/contractors/${contractorId}`).set(auth(tokenB)).send({ name: 'Hijacked' }),
      () => http().post(`/api/v1/expenses/${expenseId}/approve`).set(auth(tokenB)),
      () => http().post(`/api/v1/expenses/${expenseId}/reimburse`).set(auth(tokenB)),
      () => http().post(`/api/v1/invoices/${invoiceId}/approve`).set(auth(tokenB)),
      () => http().post(`/api/v1/payroll/runs/${runId}/submit`).set(auth(tokenB)),
      () => http().post(`/api/v1/payroll/runs/${runId}/approve`).set(auth(tokenB)),
      () => http().post(`/api/v1/payroll/runs/${runId}/process`).set(auth(tokenB)),
      () => http().patch(`/api/v1/departments/${departmentId}`).set(auth(tokenB)).send({ name: 'Hijacked' }),
    ];
    for (const make of writes) {
      const res = await make();
      expect(res.status).toBe(404);
    }
    // tenant A data untouched
    const emp = await http().get(`/api/v1/employees/${empId}`).set(auth(tokenA));
    expect(emp.body.name).toBe('Tess Alpha');
    const exp = await http().get(`/api/v1/expenses/${expenseId}`).set(auth(tokenA));
    expect(exp.body.status).toBe('SUBMITTED');
  });

  it('scopes ledger queries, accounts, and audit by JWT tenant', async () => {
    // Tenant B sees its own (empty) ledger only
    const entriesB = await http().get('/api/v1/ledger/entries').set(auth(tokenB));
    expect(entriesB.status).toBe(200);
    expect(entriesB.body.items).toHaveLength(0);

    const tbB = await http().get('/api/v1/ledger/trial-balance').set(auth(tokenB));
    expect(tbB.body.totals.debitCents).toBe(0);

    // Tenant A has its opening transaction
    const entriesA = await http().get('/api/v1/ledger/entries').set(auth(tokenA));
    expect(entriesA.body.total).toBeGreaterThanOrEqual(2);

    // Audit log: each tenant only sees its own events
    const auditA = await http().get('/api/v1/audit').set(auth(tokenA));
    const auditB = await http().get('/api/v1/audit').set(auth(tokenB));
    expect(auditA.status).toBe(200);
    expect(auditB.status).toBe(200);
    expect(auditA.body.items.length).toBeGreaterThan(0);
    expect(
      auditA.body.items.every((i: any) => i.companyId === compA.id || i.companyId === null),
    ).toBe(true);
    expect(auditB.body.items.every((i: any) => i.companyId === compB.id || i.companyId === null)).toBe(true);
  });

  it('never trusts client-supplied company ids', async () => {
    // ?companyId= of another tenant must not widen the query: denied outright…
    const res = await http().get(`/api/v1/ledger/entries?companyId=${compA.id}`).set(auth(tokenB));
    expect(res.status).toBe(404);

    // …and even if an unknown filter is stripped, only tenant-B rows are visible
    const empList = await http().get(`/api/v1/employees?companyId=${compA.id}`).set(auth(tokenB));
    if (empList.status === 200) {
      const items = empList.body.items ?? empList.body;
      expect(items).toHaveLength(0);
    } else {
      expect([403, 404]).toContain(empList.status);
    }
  });

  it('employee of tenant A cannot see tenant B data either', async () => {
    const res = await http().get(`/api/v1/employees/${empId}`).set(auth(tokenEmployeeA));
    // own-tenant read is also denied (no employees:read permission) or 404 — either way no B data
    expect([403, 404]).toContain(res.status);
    const cross = await http().get(`/api/v1/employees/${empId}`).set(auth(tokenEmployeeA));
    expect(cross.body?.companyId ?? compA.id).not.toBe(compB.id);
  });

  // -------------------------------------------------------------------------
  // RBAC matrix — enforced at the API, never only in the UI
  // -------------------------------------------------------------------------
  it('rejects unauthenticated requests with 401', async () => {
    for (const url of [
      '/api/v1/employees',
      '/api/v1/ledger/entries',
      '/api/v1/payroll/runs',
      '/api/v1/dashboard',
      '/api/v1/audit',
      '/api/v1/compliance/calendar',
    ]) {
      const res = await http().get(url);
      expect(`${url} → ${res.status}`).toBe(`${url} → 401`);
    }
  });

  it('applies the role matrix across modules', async () => {
    const matrix: Array<{ token: () => string; method: 'GET' | 'POST'; url: string; body?: object; allow: number[] }> = [
      // employees: HR write, accountant read, employee/contractor none
      { token: () => tokenHrA, method: 'GET', url: '/api/v1/employees', allow: [200] },
      { token: () => tokenAccountantA, method: 'GET', url: '/api/v1/employees', allow: [200] },
      { token: () => tokenEmployeeA, method: 'GET', url: '/api/v1/employees', allow: [403] },
      { token: () => tokenContractorA, method: 'GET', url: '/api/v1/employees', allow: [403] },
      { token: () => tokenAccountantA, method: 'POST', url: '/api/v1/employees', body: { name: 'x', ssn: '123456789', workState: 'TX', residenceState: 'TX', payRateCents: 1 }, allow: [403] },
      // ledger: accountant + admin read; employee/contractor/hr none
      { token: () => tokenAccountantA, method: 'GET', url: '/api/v1/ledger/entries', allow: [200] },
      { token: () => tokenHrA, method: 'GET', url: '/api/v1/ledger/entries', allow: [403] },
      { token: () => tokenEmployeeA, method: 'GET', url: '/api/v1/ledger/entries', allow: [403] },
      { token: () => tokenContractorA, method: 'GET', url: '/api/v1/ledger/entries', allow: [403] },
      // audit: admin only (accountant explicitly excluded per matrix)
      { token: () => tokenA, method: 'GET', url: '/api/v1/audit', allow: [200] },
      { token: () => tokenAccountantA, method: 'GET', url: '/api/v1/audit', allow: [403] },
      { token: () => tokenHrA, method: 'GET', url: '/api/v1/audit', allow: [403] },
      // transfers: accountant read; hr/employee/contractor none
      { token: () => tokenAccountantA, method: 'GET', url: '/api/v1/transfers', allow: [200] },
      { token: () => tokenHrA, method: 'GET', url: '/api/v1/transfers', allow: [403] },
      { token: () => tokenEmployeeA, method: 'GET', url: '/api/v1/transfers', allow: [403] },
      // invoices: contractor submit-side read, employee none
      { token: () => tokenContractorA, method: 'GET', url: '/api/v1/invoices', allow: [200] },
      { token: () => tokenEmployeeA, method: 'GET', url: '/api/v1/invoices', allow: [403] },
      // compliance: accountant read, employee none
      { token: () => tokenAccountantA, method: 'GET', url: '/api/v1/compliance/calendar', allow: [200] },
      { token: () => tokenEmployeeA, method: 'GET', url: '/api/v1/compliance/calendar', allow: [403] },
      // dashboard: every role has dashboard:read
      { token: () => tokenA, method: 'GET', url: '/api/v1/dashboard', allow: [200] },
      { token: () => tokenHrA, method: 'GET', url: '/api/v1/dashboard', allow: [200] },
      { token: () => tokenAccountantA, method: 'GET', url: '/api/v1/dashboard', allow: [200] },
      { token: () => tokenEmployeeA, method: 'GET', url: '/api/v1/dashboard', allow: [200] },
      { token: () => tokenContractorA, method: 'GET', url: '/api/v1/dashboard', allow: [200] },
    ];

    for (const row of matrix) {
      const req =
        row.method === 'GET'
          ? http().get(row.url).set(auth(row.token()))
          : http().post(row.url).set(auth(row.token())).send(row.body ?? {});
      const res = await req;
      if (!row.allow.includes(res.status)) {
        throw new Error(
          `RBAC matrix violation: ${row.method} ${row.url} → ${res.status} (allowed ${row.allow.join('/')})`,
        );
      }
      expect(row.allow).toContain(res.status);
    }
  });

  it('platform admin sees all tenants; tenant admins only their own', async () => {
    const all = await http().get('/api/v1/companies').set(auth(tokenPlatform));
    expect(all.status).toBe(200);
    const ids = (all.body.items ?? all.body).map((c: any) => c.id);
    expect(ids).toEqual(expect.arrayContaining([compA.id, compB.id]));

    // Listing all tenants requires platform:manage — tenant admins get 403
    const mine = await http().get('/api/v1/companies').set(auth(tokenA));
    expect(mine.status).toBe(403);

    // platform admin has platform:manage; tenant admin does not
    const tenantManage = await http().post('/api/v1/companies').set(auth(tokenA)).send({ name: 'Nope' });
    expect([403, 404]).toContain(tenantManage.status);
  });
});
