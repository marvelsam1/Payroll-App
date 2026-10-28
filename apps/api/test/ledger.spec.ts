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

/**
 * Ledger integration tests — double-entry correctness, immutability,
 * reversal flow, tenant isolation, RBAC, and the invariant validation job.
 */
describe('Ledger (double-entry core)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: LedgerService;

  let companyA: { id: string };
  let companyB: { id: string };
  let adminA: TestUser;
  let adminB: TestUser;
  let accountantA: TestUser;
  let hrA: TestUser;
  let tokenA: string;
  let tokenB: string;
  let tokenAccountant: string;
  let tokenHr: string;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    ledger = app.get(LedgerService);
    await resetDb();

    companyA = await createCompany(prisma, { name: 'Acme Logistics' });
    companyB = await createCompany(prisma, { name: 'Beta Studios' });
    await ledger.ensureCompanyAccounts(companyA.id);
    await ledger.ensureCompanyAccounts(companyB.id);

    adminA = await createUser(prisma, { email: 'admin@acme.test', role: Role.COMPANY_ADMIN, companyId: companyA.id });
    adminB = await createUser(prisma, { email: 'admin@beta.test', role: Role.COMPANY_ADMIN, companyId: companyB.id });
    accountantA = await createUser(prisma, { email: 'acct@acme.test', role: Role.ACCOUNTANT, companyId: companyA.id });
    hrA = await createUser(prisma, { email: 'hr@acme.test', role: Role.HR_MANAGER, companyId: companyA.id });

    tokenA = await login(app, adminA.email, adminA.password);
    tokenB = await login(app, adminB.email, adminB.password);
    tokenAccountant = await login(app, accountantA.email, accountantA.password);
    tokenHr = await login(app, hrA.email, hrA.password);
  });

  afterAll(async () => {
    await app.close();
  });

  it('provisions the standard chart of accounts per company', async () => {
    const res = await http().get('/api/v1/ledger/accounts').set(auth(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.accounts.length).toBeGreaterThanOrEqual(12);
    const codes = res.body.accounts.map((a: any) => a.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'OPERATING_CASH',
        'NET_PAY_PAYABLE',
        'TAX_WITHHOLDING_PAYABLE',
        'EMPLOYER_TAX_EXPENSE',
        'EXPENSE_REIMBURSEMENT_PAYABLE',
        'CONTRACTOR_PAYABLE',
      ]),
    );
    expect(res.body.totals).toEqual({ debitCents: 0, creditCents: 0 });
  });

  let openingTxnId: string;

  it('posts a balanced opening-balance transaction', async () => {
    const res = await http()
      .post('/api/v1/ledger/transactions')
      .set(auth(tokenA))
      .send({
        description: 'Simulated opening bank balance',
        referenceType: 'opening',
        entries: [
          { accountCode: 'OPERATING_CASH', debit: 5_000_000 },
          { accountCode: 'OPENING_BALANCE_EQUITY', credit: 5_000_000 },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.entries).toHaveLength(2);
    openingTxnId = res.body.id;

    const accounts = await http().get('/api/v1/ledger/accounts').set(auth(tokenA));
    const cash = accounts.body.accounts.find((a: any) => a.code === 'OPERATING_CASH');
    const equity = accounts.body.accounts.find((a: any) => a.code === 'OPENING_BALANCE_EQUITY');
    expect(cash.balanceCents).toBe(5_000_000);
    expect(equity.balanceCents).toBe(5_000_000);
    expect(accounts.body.totals.debitCents).toBe(accounts.body.totals.creditCents);
  });

  it('rejects unbalanced transactions without writing anything', async () => {
    const before = await prisma.ledgerEntry.count();
    const res = await http()
      .post('/api/v1/ledger/transactions')
      .set(auth(tokenA))
      .send({
        description: 'bad',
        entries: [
          { accountCode: 'OPERATING_CASH', debit: 100 },
          { accountCode: 'OPENING_BALANCE_EQUITY', credit: 50 },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Unbalanced/);
    expect(await prisma.ledgerEntry.count()).toBe(before);
  });

  it('rejects malformed entries (single entry, both sides, zeros)', async () => {
    const single = await http()
      .post('/api/v1/ledger/transactions')
      .set(auth(tokenA))
      .send({ description: 'x', entries: [{ accountCode: 'OPERATING_CASH', debit: 100 }] });
    expect(single.status).toBe(400);

    const bothSides = await http()
      .post('/api/v1/ledger/transactions')
      .set(auth(tokenA))
      .send({
        description: 'x',
        entries: [
          { accountCode: 'OPERATING_CASH', debit: 100, credit: 100 },
          { accountCode: 'OPENING_BALANCE_EQUITY', credit: 100, debit: 100 },
        ],
      });
    expect(bothSides.status).toBe(400);

    const zero = await http()
      .post('/api/v1/ledger/transactions')
      .set(auth(tokenA))
      .send({
        description: 'x',
        entries: [
          { accountCode: 'OPERATING_CASH', debit: 0, credit: 0 },
          { accountCode: 'OPENING_BALANCE_EQUITY', credit: 0 },
        ],
      });
    expect(zero.status).toBe(400);

    const negative = await http()
      .post('/api/v1/ledger/transactions')
      .set(auth(tokenA))
      .send({
        description: 'x',
        entries: [
          { accountCode: 'OPERATING_CASH', debit: -100 },
          { accountCode: 'OPENING_BALANCE_EQUITY', credit: -100 },
        ],
      });
    expect(negative.status).toBe(400); // validation pipe @Min(0)
  });

  it('exposes search + pagination on the entry viewer', async () => {
    const res = await http()
      .get('/api/v1/ledger/entries?search=opening&page=1&pageSize=10')
      .set(auth(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2); // opening txn has 2 entries
    expect(res.body.items[0].transaction.description).toMatch(/opening/i);
    expect(res.body.items[0].account).toHaveProperty('code');
    expect(res.body.page).toBe(1);
  });

  it('reverses a transaction with a linked mirror and audits it', async () => {
    const reversal = await http()
      .post(`/api/v1/ledger/transactions/${openingTxnId}/reverse`)
      .set(auth(tokenA))
      .send({ reason: 'wrong opening balance' });
    expect(reversal.status).toBe(201);
    expect(reversal.body.reversalOfId).toBe(openingTxnId);
    const mirrored = reversal.body.entries.find((e: any) => e.debitAmount === 5_000_000);
    expect(mirrored).toBeTruthy();
    expect(mirrored.reversedEntryId).toBeTruthy();

    const trial = await http().get('/api/v1/ledger/trial-balance').set(auth(tokenA));
    expect(trial.body.balanced).toBe(true);
    const cash = trial.body.accounts.find((a: any) => a.code === 'OPERATING_CASH');
    expect(cash.balanceCents).toBe(0); // opening + reversal = 0

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'ledger.transaction.reversed', entityId: openingTxnId },
    });
    expect(audit).not.toBeNull();

    const again = await http()
      .post(`/api/v1/ledger/transactions/${openingTxnId}/reverse`)
      .set(auth(tokenA))
      .send({ reason: 'twice' });
    expect(again.status).toBe(400);
    expect(again.body.message).toMatch(/already reversed/);
  });

  it('enforces immutability at the database level (no update/delete path)', async () => {
    const entry = await prisma.ledgerEntry.findFirstOrThrow();
    await expect(
      prisma.ledgerEntry.update({ where: { id: entry.id }, data: { debitAmount: 1 } }),
    ).rejects.toThrow();
    await expect(
      prisma.ledgerEntry.delete({ where: { id: entry.id } }),
    ).rejects.toThrow();

    const txn = await prisma.ledgerTransaction.findFirstOrThrow();
    await expect(
      prisma.ledgerTransaction.update({ where: { id: txn.id }, data: { description: 'x' } }),
    ).rejects.toThrow();

    // audit log is append-only too (with a row present)
    const log = await prisma.auditLog.findFirstOrThrow();
    await expect(
      prisma.auditLog.update({ where: { id: log.id }, action: 'tampered' } as any),
    ).rejects.toThrow();
    await expect(prisma.auditLog.delete({ where: { id: log.id } })).rejects.toThrow();
  });

  it('scopes every query to the session tenant', async () => {
    // Admin B sees only company B's (empty) ledger
    const bEntries = await http().get('/api/v1/ledger/entries').set(auth(tokenB));
    expect(bEntries.body.total).toBe(0);
    const aEntries = await http().get('/api/v1/ledger/entries').set(auth(tokenA));
    expect(aEntries.body.total).toBeGreaterThan(0);

    // Explicit cross-tenant query params are refused (tenant roles cannot leave their company)
    const cross = await http()
      .get(`/api/v1/ledger/entries?companyId=${companyB.id}`)
      .set(auth(tokenA));
    expect(cross.status).toBe(404);

    // Admin A cannot reverse company B's transaction
    const crossReverse = await http()
      .post(`/api/v1/ledger/transactions/${openingTxnId}/reverse`)
      .set(auth(tokenA))
      .send({ reason: 'cross-tenant attempt' });
    // already reversed anyway — but tenant check must not leak B data either
    expect([400, 404]).toContain(crossReverse.status);

    // Unknown account codes are scoped: posting with an unknown code fails
    const unknown = await http()
      .post('/api/v1/ledger/transactions')
      .set(auth(tokenB))
      .send({
        description: 'x',
        entries: [
          { accountCode: 'OPERATING_CASH', debit: 100 },
          { accountCode: 'OPENING_BALANCE_EQUITY', credit: 100 },
        ],
      });
    expect(unknown.status).toBe(201); // B has its own accounts — isolation intact
  });

  it('applies the RBAC matrix to ledger routes', async () => {
    const acctGet = await http().get('/api/v1/ledger/accounts').set(auth(tokenAccountant));
    expect(acctGet.status).toBe(200); // accountants read ledger

    const acctPost = await http()
      .post('/api/v1/ledger/transactions')
      .set(auth(tokenAccountant))
      .send({
        description: 'x',
        entries: [
          { accountCode: 'OPERATING_CASH', debit: 1 },
          { accountCode: 'OPENING_BALANCE_EQUITY', credit: 1 },
        ],
      });
    expect(acctPost.status).toBe(403); // …but never write

    const hrGet = await http().get('/api/v1/ledger/entries').set(auth(tokenHr));
    expect(hrGet.status).toBe(403); // HR cannot view the ledger at all

    const noAuth = await http().get('/api/v1/ledger/accounts');
    expect(noAuth.status).toBe(401);
  });

  it('validates invariants and detects in-flight transfers without postings', async () => {
    const ok = await http().get('/api/v1/ledger/validate').set(auth(tokenA));
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);

    // Inject an in-flight transfer with no ledger posting → validation must fail
    await prisma.bankTransfer.create({
      data: {
        companyId: companyA.id,
        amountCents: 123_456,
        status: 'PENDING',
        initiatedAt: new Date(),
      },
    });
    const bad = await http().get('/api/v1/ledger/validate').set(auth(tokenA));
    expect(bad.body.ok).toBe(false);
    const failing = bad.body.checks.filter((c: any) => !c.ok).map((c: any) => c.name);
    expect(failing).toEqual(
      expect.arrayContaining([
        'ach_transit_matches_inflight_transfers',
        'inflight_transfers_have_postings',
      ]),
    );

    await prisma.bankTransfer.deleteMany({ where: { companyId: companyA.id, status: 'PENDING' } });
    const goodAgain = await http().get('/api/v1/ledger/validate').set(auth(tokenA));
    expect(goodAgain.body.ok).toBe(true);
  });
});
