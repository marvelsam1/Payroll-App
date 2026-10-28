import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import * as zlib from 'zlib';

/** Extract text operators from a (compressed) PDF for content assertions. */
function pdfText(buf: Buffer): string {
  const s = buf.toString('latin1');
  const re = /stream\r?\n/g;
  const marker = 'endstream';
  let out = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf(marker, start);
    if (end < 0) continue;
    const raw = buf.subarray(start, end);
    let text = '';
    for (const candidate of [raw, raw.subarray(0, raw.length - 1), raw.subarray(0, raw.length - 2)]) {
      try {
        text = zlib.inflateSync(candidate).toString('latin1');
        break;
      } catch {
        /* try next */
      }
    }
    const decoded = text || raw.toString('latin1');
    // PDF text operators store strings as hex: <466F726D…> → "Form…"
    out += decoded.replace(/<([0-9A-Fa-f\s]+)>/g, (whole, hex: string) => {
      try {
        return Buffer.from(hex.replace(/\s+/g, ''), 'hex').toString('latin1');
      } catch {
        return whole;
      }
    });
    re.lastIndex = end;
  }
  return out;
}
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
 * Phase 4: compliance PDFs (watermarked simulation), filing calendar,
 * jurisdiction checks, and the append-only AuditLog with activity viewer.
 */
describe('Compliance forms + immutable audit log', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: LedgerService;

  let company: { id: string };
  let admin: TestUser;
  let accountant: TestUser;
  let tokenAdmin = '';
  let tokenAccountant = '';
  let tokenPlatform = '';
  let tokenEmployee = '';

  const YEAR = new Date().getFullYear();
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    ledger = app.get(LedgerService);
    await resetDb();

    company = await createCompany(prisma, { name: 'Compliance Inc', defaultState: 'CA' });
    await ledger.ensureCompanyAccounts(company.id);

    admin = await createUser(prisma, { email: 'admin@comp.test', role: Role.COMPANY_ADMIN, companyId: company.id });
    accountant = await createUser(prisma, { email: 'acct@comp.test', role: Role.ACCOUNTANT, companyId: company.id });
    const platform = await createUser(prisma, { email: 'root@comp.test', role: Role.PLATFORM_ADMIN, companyId: null });
    tokenAdmin = await login(app, admin.email, admin.password);
    tokenAccountant = await login(app, accountant.email, accountant.password);
    tokenPlatform = await login(app, platform.email, platform.password);

    // Cross-state employee: works CA, lives NY (non-reciprocal)
    await http()
      .post('/api/v1/employees')
      .set(auth(tokenAdmin))
      .send({
        name: 'Casey North',
        email: 'casey@comp.test',
        ssn: '666666666',
        workState: 'CA',
        residenceState: 'NY',
        residenceCity: 'New York',
        payType: 'SALARIED',
        payRateCents: 6_000_000,
        createUser: true,
        password: 'Password123!',
      });
    // Reciprocal pair: works NY, lives NJ
    await http()
      .post('/api/v1/employees')
      .set(auth(tokenAdmin))
      .send({
        name: 'Reese Garden',
        email: 'reese@comp.test',
        ssn: '777777777',
        workState: 'NY',
        residenceState: 'NJ',
        payType: 'SALARIED',
        payRateCents: 5_000_000,
      });

    tokenEmployee = await login(app, 'casey@comp.test', 'Password123!');
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Payroll history so forms have real data
  // -------------------------------------------------------------------------
  it('completes a payroll run so compliance forms aggregate real data', async () => {
    const draft = await http()
      .post('/api/v1/payroll/runs')
      .set(auth(tokenAdmin))
      .send({ periodStart: `${YEAR}-01-01`, periodEnd: `${YEAR}-01-14` });
    expect(draft.status).toBe(201);
    await http().post(`/api/v1/payroll/runs/${draft.body.id}/submit`).set(auth(tokenAdmin));
    await http().post(`/api/v1/payroll/runs/${draft.body.id}/approve`).set(auth(tokenAdmin));
    await http().post(`/api/v1/payroll/runs/${draft.body.id}/process`).set(auth(tokenAdmin));
    const done = await until(async () => {
      const res = await http().get(`/api/v1/payroll/runs/${draft.body.id}`).set(auth(tokenAdmin));
      return res.body.status === 'COMPLETED' ? res.body : null;
    });
    expect(done.journalTxnId).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Filing calendar + jurisdiction
  // -------------------------------------------------------------------------
  it('exposes the statutory filing calendar with 941/W-2/SUTA events', async () => {
    const res = await http().get(`/api/v1/compliance/calendar?year=${YEAR}`).set(auth(tokenAdmin));
    expect(res.status).toBe(200);
    const forms = res.body.map((e: any) => e.form);
    expect(forms).toEqual(expect.arrayContaining(['941', 'W-2', 'SUTA']));
    expect(res.body.every((e: any) => e.due === true)).toBe(true);
    expect(
      res.body.every((e: any) => ['upcoming', 'overdue', 'simulated_filed'].includes(e.status)),
    ).toBe(true);
    // Q1 (Jan payroll completed) must show as simulated_filed for 941
    const q1 = res.body.find((e: any) => e.form === '941' && e.title.includes('Q1'));
    expect(q1.status).toBe('simulated_filed');
    // events sorted by date
    const dates = res.body.map((e: any) => e.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('runs the jurisdiction check across work/residence states', async () => {
    const res = await http().get('/api/v1/compliance/jurisdiction-check').set(auth(tokenAdmin));
    expect(res.status).toBe(200);
    expect(res.body.summary.totalActive).toBe(2);
    expect(res.body.summary.crossState).toBe(2);
    expect(res.body.summary.reciprocal).toBe(1); // NY↔NJ
    expect(res.body.summary.nonReciprocal).toBe(1); // CA↔NY
    expect(res.body.summary.nycResidents).toBe(1);

    const nyNj = res.body.employees.find((e: any) => e.residenceState === 'NJ');
    expect(nyNj.reciprocal).toBe(true);
    expect(nyNj.note).toContain('Reciprocal');

    const caNy = res.body.employees.find((e: any) => e.residenceState === 'NY');
    expect(caNy.reciprocal).toBe(false);
    expect(caNy.note).toContain('CA');
  });

  it('lists configured state rules for the UI', async () => {
    const res = await http().get('/api/v1/compliance/states').set(auth(tokenAdmin));
    expect(res.status).toBe(200);
    expect(res.body.states.map((s: any) => s.code)).toEqual(['CA', 'TX', 'PA', 'NY', 'NJ']);
    expect(res.body.frequencies).toEqual(
      expect.arrayContaining([{ frequency: 'BIWEEKLY', periodsPerYear: 26 }]),
    );
    expect(res.body.disclaimer).toContain('not certified');
  });

  // -------------------------------------------------------------------------
  // Watermarked PDFs
  // -------------------------------------------------------------------------
  it('serves watermarked Form 941 / W-2 / SUTA PDFs marked SIMULATED', async () => {
    const emp = await prisma.employee.findFirst({ where: { companyId: company.id } });

    const f941 = await http()
      .get(`/api/v1/compliance/forms/941?periodStart=${YEAR}-01-01&periodEnd=${YEAR}-03-31`)
      .set(auth(tokenAdmin));
    expect(f941.status).toBe(200);
    expect(f941.headers['content-type']).toContain('application/pdf');
    expect(f941.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(f941.body.length).toBeGreaterThan(1_000);
    const f941Text = pdfText(f941.body);
    expect(f941Text).toContain('SIMULATED');
    expect(f941Text).toContain('NOT FOR FILING');
    expect(f941Text).toContain('Form 941');

    const w2 = await http()
      .get(`/api/v1/compliance/forms/w2?employeeId=${emp!.id}&year=${YEAR}`)
      .set(auth(tokenAdmin));
    expect(w2.status).toBe(200);
    expect(w2.body.subarray(0, 5).toString()).toBe('%PDF-');
    const w2Text = pdfText(w2.body);
    expect(w2Text).toContain('NOT FOR FILING');
    expect(w2Text).toContain('W-2');

    const suta = await http()
      .get(`/api/v1/compliance/forms/suta?year=${YEAR}&quarter=1`)
      .set(auth(tokenAdmin));
    expect(suta.status).toBe(200);
    expect(suta.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdfText(suta.body)).toContain('NOT FOR FILING');
  });

  it('gates form generation: accountant read-only, employee denied', async () => {
    const acctCalendar = await http().get('/api/v1/compliance/calendar').set(auth(tokenAccountant));
    expect(acctCalendar.status).toBe(200);

    const acctForm = await http().get('/api/v1/compliance/forms/941').set(auth(tokenAccountant));
    expect(acctForm.status).toBe(403);

    const empCalendar = await http().get('/api/v1/compliance/calendar').set(auth(tokenEmployee));
    expect(empCalendar.status).toBe(403);

    const empForm = await http().get('/api/v1/compliance/forms/w2').set(auth(tokenEmployee));
    expect(empForm.status).toBe(403);
  });

  it('offers the W-2 employee picker for the compliance UI', async () => {
    const res = await http().get('/api/v1/compliance/w2-employees').set(auth(tokenAdmin));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0]).toHaveProperty('name');
  });

  // -------------------------------------------------------------------------
  // Audit log viewer + immutability
  // -------------------------------------------------------------------------
  it('records audit events for financial actions and lists them', async () => {
    const res = await http().get('/api/v1/audit').set(auth(tokenAdmin));
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(3);
    const actions = res.body.items.map((i: any) => i.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'payroll.run.completed',
        'payroll.run.submitted',
        'employee.created',
        'ach.transfer.settled',
      ]),
    );
    // actor attribution present
    expect(res.body.items.every((i: any) => i.actorEmail || i.actorId)).toBe(true);

    const filtered = await http().get('/api/v1/audit?action=payroll').set(auth(tokenAdmin));
    expect(filtered.body.items.length).toBeGreaterThanOrEqual(1);
    expect(
      filtered.body.items.every((i: any) => i.action.includes('payroll')),
    ).toBe(true);

    const paged = await http().get('/api/v1/audit?page=1&pageSize=2').set(auth(tokenAdmin));
    expect(paged.body.items).toHaveLength(2);
    expect(paged.body.pageSize).toBe(2);
  });

  it('restricts audit access: accountant/HR/employee denied; platform admin global', async () => {
    expect((await http().get('/api/v1/audit').set(auth(tokenAccountant))).status).toBe(403);

    const hr = await createUser(prisma, { email: 'hr@comp.test', role: Role.HR_MANAGER, companyId: company.id });
    const tokenHr = await login(app, hr.email, hr.password);
    expect((await http().get('/api/v1/audit').set(auth(tokenHr))).status).toBe(403);

    expect((await http().get('/api/v1/audit').set(auth(tokenEmployee))).status).toBe(403);

    const platformView = await http().get('/api/v1/audit').set(auth(tokenPlatform));
    expect(platformView.status).toBe(200);
    expect(platformView.body.items.length).toBeGreaterThanOrEqual(3);
  });

  it('AuditLog is immutable at the database level (UPDATE/DELETE rejected)', async () => {
    // Ensure at least one row exists (previous actions created several)
    const seed = await prisma.auditLog.findFirst();
    expect(seed).toBeTruthy();

    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await expect(
        client.query(`UPDATE "AuditLog" SET action = 'tampered' WHERE id = $1`, [seed!.id]),
      ).rejects.toThrow(/append-only|trigger/i);

      await expect(
        client.query(`DELETE FROM "AuditLog" WHERE id = $1`, [seed!.id]),
      ).rejects.toThrow(/append-only|trigger/i);

      // row untouched
      const check = await client.query(`SELECT action FROM "AuditLog" WHERE id = $1`, [seed!.id]);
      expect(check.rows[0].action).toBe(seed!.action);
    } finally {
      await client.end();
    }

    // No HTTP delete/update route exists for audit entries
    const del = await http().delete(`/api/v1/audit/${seed!.id}`).set(auth(tokenAdmin));
    expect(del.status).toBe(404);
  });

  it('keeps ledger entries append-only alongside audit (re-verified with data)', async () => {
    const entries = await http().get('/api/v1/ledger/entries?pageSize=1').set(auth(tokenAdmin));
    expect(entries.body.total).toBeGreaterThan(0);
    const entryId = entries.body.items[0].id;

    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await expect(
        client.query(`UPDATE "LedgerEntry" SET "debitAmount" = 1 WHERE id = $1`, [entryId]),
      ).rejects.toThrow(/append-only|trigger/i);
      await expect(
        client.query(`DELETE FROM "LedgerEntry" WHERE id = $1`, [entryId]),
      ).rejects.toThrow(/append-only|trigger/i);
    } finally {
      await client.end();
    }
  });
});
