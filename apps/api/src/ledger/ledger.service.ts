import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.module';
import { SessionUser } from '../common/decorators';
import { ACCOUNT_CATALOG, ACCOUNT_CODES } from './account-catalog';

type TxClient = Prisma.TransactionClient;

export interface PostEntryInput {
  accountCode: string;
  debit?: number;
  credit?: number;
  relatedEntityType?: string;
  relatedEntityId?: string;
  /** Set on reversal entries: id of the original entry being reversed. */
  reversedEntryId?: string;
}

export interface PostTransactionInput {
  companyId: string;
  date?: Date;
  description: string;
  referenceType?: string;
  referenceId?: string;
  createdBy?: string;
  entries: PostEntryInput[];
}

export interface EntryQuery {
  accountId?: string;
  from?: string;
  to?: string;
  referenceType?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ValidationReport {
  ok: boolean;
  checkedAt: string;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
}

/**
 * Double-entry ledger — the financial centerpiece.
 *
 * Invariants (enforced in app code AND by deferred DB triggers):
 *  - Every transaction has SUM(debits) === SUM(credits) — checked at COMMIT.
 *  - Every entry has exactly one non-zero side, integer cents, no negatives.
 *  - Entries & transactions are IMMUTABLE: no update/delete code path exists
 *    anywhere; corrections are made only by posting reversing transactions
 *    that cross-link via reversedEntryId / reversalOfId.
 *  - Company scoping is applied to every query (tenant isolation).
 *
 * Account balances are never stored as a single mutable field — they are
 * always derived by aggregating immutable entries.
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Provision the standard chart of accounts for a new company (idempotent). */
  async ensureCompanyAccounts(companyId: string): Promise<void> {
    await this.prisma.ledgerAccount.createMany({
      data: ACCOUNT_CATALOG.map((a) => ({ companyId, ...a })),
      skipDuplicates: true,
    });
  }

  /**
   * Post a balanced transaction atomically. Throws before writing if
   * unbalanced. Pass an open transaction client to join an outer transaction.
   */
  async postTransaction(input: PostTransactionInput, outerTx?: TxClient) {
    this.assertValidEntries(input.entries);

    const codes = [...new Set(input.entries.map((e) => e.accountCode))];
    const accounts = await this.prisma.ledgerAccount.findMany({
      where: { companyId: input.companyId, code: { in: codes } },
    });
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    const missing = codes.filter((c) => !byCode.has(c));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Unknown ledger account(s) for this company: ${missing.join(', ')}`,
      );
    }

    const run = async (tx: TxClient) => {
      const txn = await tx.ledgerTransaction.create({
        data: {
          companyId: input.companyId,
          date: input.date ?? new Date(),
          description: input.description,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          createdBy: input.createdBy,
        },
      });
      await tx.ledgerEntry.createMany({
        data: input.entries.map((e) => {
          const account = byCode.get(e.accountCode)!;
          return {
            companyId: input.companyId,
            accountId: account.id,
            transactionId: txn.id,
            debitAmount: e.debit ?? 0,
            creditAmount: e.credit ?? 0,
            relatedEntityType: e.relatedEntityType,
            relatedEntityId: e.relatedEntityId,
            reversedEntryId: e.reversedEntryId,
          };
        }),
      });
      return tx.ledgerTransaction.findUniqueOrThrow({
        where: { id: txn.id },
        include: { entries: { include: { account: true } } },
      });
    };

    if (outerTx) return run(outerTx);
    return this.prisma.$transaction(run);
  }

  /**
   * Correct a posted transaction by posting its exact mirror (debit↔credit).
   * The original stays forever; the reversal links back via reversalOfId and
   * each new entry records reversedEntryId.
   */
  async reverseTransaction(
    companyId: string,
    transactionId: string,
    opts: { actor: SessionUser; reason: string },
  ) {
    const original = await this.prisma.ledgerTransaction.findFirst({
      where: { id: transactionId, companyId },
      include: { entries: { include: { account: true } } },
    });
    if (!original) throw new NotFoundException('Transaction not found');

    const existing = await this.prisma.ledgerTransaction.findFirst({
      where: { reversalOfId: original.id },
    });
    if (existing) {
      throw new BadRequestException(
        `Transaction already reversed by ${existing.id}`,
      );
    }
    if (original.entries.length === 0) {
      throw new BadRequestException('Cannot reverse a transaction with no entries');
    }

    const reversal = await this.prisma.$transaction(async (tx) => {
      const txn = await tx.ledgerTransaction.create({
        data: {
          companyId,
          date: new Date(),
          description: `Reversal of ${original.description}${opts.reason ? ` — ${opts.reason}` : ''}`,
          referenceType: 'reversal',
          referenceId: original.id,
          reversalOfId: original.id,
          createdBy: opts.actor.id,
        },
      });
      await tx.ledgerEntry.createMany({
        data: original.entries.map((e) => ({
          companyId,
          accountId: e.accountId,
          transactionId: txn.id,
          debitAmount: e.creditAmount, // mirror
          creditAmount: e.debitAmount,
          relatedEntityType: e.relatedEntityType,
          relatedEntityId: e.relatedEntityId,
          reversedEntryId: e.id,
        })),
      });
      return tx.ledgerTransaction.findUniqueOrThrow({
        where: { id: txn.id },
        include: { entries: { include: { account: true } } },
      });
    });

    await this.audit.record({
      actor: opts.actor,
      action: 'ledger.transaction.reversed',
      entityType: 'LedgerTransaction',
      entityId: original.id,
      before: { transactionId: original.id, description: original.description },
      after: { reversalId: reversal.id, reason: opts.reason },
    });

    return reversal;
  }

  /** All accounts with balances derived purely from immutable entries. */
  async getAccountBalances(companyId: string) {
    const [accounts, sums] = await Promise.all([
      this.prisma.ledgerAccount.findMany({
        where: { companyId },
        orderBy: { code: 'asc' },
      }),
      this.prisma.ledgerEntry.groupBy({
        by: ['accountId'],
        where: { companyId },
        _sum: { debitAmount: true, creditAmount: true },
      }),
    ]);
    const sumByAccount = new Map(
      sums.map((s) => [
        s.accountId,
        { debit: s._sum.debitAmount ?? 0, credit: s._sum.creditAmount ?? 0 },
      ]),
    );

    const rows = accounts.map((a) => {
      const sum = sumByAccount.get(a.id) ?? { debit: 0, credit: 0 };
      const netSigned = sum.debit - sum.credit;
      return {
        id: a.id,
        code: a.code,
        accountName: a.accountName,
        accountType: a.accountType,
        normalSide: a.normalSide,
        debitTotalCents: sum.debit,
        creditTotalCents: sum.credit,
        balanceCents: a.normalSide === 'DEBIT' ? netSigned : -netSigned,
        netSignedCents: netSigned,
      };
    });

    const totals = rows.reduce(
      (acc, r) => ({
        debitCents: acc.debitCents + r.debitTotalCents,
        creditCents: acc.creditCents + r.creditTotalCents,
      }),
      { debitCents: 0, creditCents: 0 },
    );

    return { accounts: rows, totals };
  }

  /** Paginated, searchable entry listing (the ledger viewer API). */
  async listEntries(companyId: string, q: EntryQuery) {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 50));
    const where: Prisma.LedgerEntryWhereInput = {
      companyId,
      ...(q.accountId ? { accountId: q.accountId } : {}),
      ...(q.referenceType ? { transaction: { referenceType: q.referenceType } } : {}),
      ...(q.relatedEntityType ? { relatedEntityType: q.relatedEntityType } : {}),
      ...(q.relatedEntityId ? { relatedEntityId: q.relatedEntityId } : {}),
      ...(q.search
        ? { transaction: { description: { contains: q.search, mode: 'insensitive' } } }
        : {}),
      ...(q.from || q.to
        ? {
            transaction: {
              date: {
                ...(q.from ? { gte: new Date(q.from) } : {}),
                ...(q.to ? { lte: new Date(q.to) } : {}),
              },
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.ledgerEntry.findMany({
        where,
        include: {
          account: { select: { code: true, accountName: true, normalSide: true, accountType: true } },
          transaction: {
            select: {
              id: true,
              date: true,
              description: true,
              referenceType: true,
              referenceId: true,
              reversalOfId: true,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.ledgerEntry.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  /** Debit/credit totals per account + equality check. */
  async trialBalance(companyId: string) {
    const { accounts, totals } = await this.getAccountBalances(companyId);
    return {
      accounts,
      totals,
      balanced: totals.debitCents === totals.creditCents,
    };
  }

  /**
   * Validation job: re-verifies ledger invariants directly against stored
   * data. Exposed via API + CLI; safe to run at any time.
   */
  async validateInvariants(companyId?: string): Promise<ValidationReport> {
    const checks: ValidationReport['checks'] = [];
    const scope = companyId ? { companyId } : {};

    // 1. every transaction balances
    const grouped = await this.prisma.ledgerEntry.groupBy({
      by: ['transactionId'],
      where: scope,
      _sum: { debitAmount: true, creditAmount: true },
    });
    const unbalanced = grouped.filter(
      (g) => (g._sum.debitAmount ?? 0) !== (g._sum.creditAmount ?? 0),
    );
    checks.push({
      name: 'transactions_balanced',
      ok: unbalanced.length === 0,
      detail:
        unbalanced.length === 0
          ? `${grouped.length} transaction(s) balanced`
          : `${unbalanced.length} unbalanced transaction(s): ${unbalanced
              .slice(0, 5)
              .map((u) => u.transactionId)
              .join(', ')}`,
    });

    // 2. global debits === credits
    const global = await this.prisma.ledgerEntry.aggregate({
      where: scope,
      _sum: { debitAmount: true, creditAmount: true },
    });
    const gDebit = global._sum.debitAmount ?? 0;
    const gCredit = global._sum.creditAmount ?? 0;
    checks.push({
      name: 'global_debits_equal_credits',
      ok: gDebit === gCredit,
      detail: `debits=${gDebit} credits=${gCredit}`,
    });

    // 3. ACH transit account equals sum of in-flight transfers
    if (companyId) {
      const transit = await this.prisma.ledgerAccount.findFirst({
        where: { companyId, code: 'ACH_TRANSIT' },
      });
      const transitSum = transit
        ? await this.prisma.ledgerEntry.aggregate({
            where: { companyId, accountId: transit.id },
            _sum: { debitAmount: true, creditAmount: true },
          })
        : null;
      const transitBalance =
        (transitSum?._sum.debitAmount ?? 0) - (transitSum?._sum.creditAmount ?? 0);
      const inFlight = await this.prisma.bankTransfer.aggregate({
        where: {
          companyId,
          status: { in: ['INITIATED', 'PENDING', 'PROCESSING'] },
        },
        _sum: { amountCents: true },
      });
      const expected = inFlight._sum.amountCents ?? 0;
      checks.push({
        name: 'ach_transit_matches_inflight_transfers',
        ok: transitBalance === expected,
        detail: `transit balance=${transitBalance} in-flight transfers=${expected}`,
      });

      // 4. in-flight transfers must each have a posting entry (via related id)
      const inFlightRows = await this.prisma.bankTransfer.findMany({
        where: { companyId, status: { in: ['INITIATED', 'PENDING', 'PROCESSING'] } },
        select: { id: true },
      });
      const posted = await this.prisma.ledgerEntry.count({
        where: {
          companyId,
          relatedEntityType: 'BankTransfer',
          relatedEntityId: { in: inFlightRows.map((r) => r.id) },
        },
      });
      checks.push({
        name: 'inflight_transfers_have_postings',
        ok: posted === inFlightRows.length,
        detail: `${posted}/${inFlightRows.length} in-flight transfers have ledger postings`,
      });
    }

    return {
      ok: checks.every((c) => c.ok),
      checkedAt: new Date().toISOString(),
      checks,
    };
  }

  // -------------------------------------------------------------------------
  // Validation helpers (fail fast BEFORE touching the database)
  // -------------------------------------------------------------------------

  private assertValidEntries(entries: PostEntryInput[]): void {
    if (!entries || entries.length < 2) {
      throw new BadRequestException('A transaction needs at least two entries');
    }
    let debit = 0;
    let credit = 0;
    for (const [i, e] of entries.entries()) {
      const d = e.debit ?? 0;
      const c = e.credit ?? 0;
      if (!Number.isInteger(d) || !Number.isInteger(c)) {
        throw new BadRequestException(`Entry ${i}: amounts must be integer cents`);
      }
      if (d < 0 || c < 0) {
        throw new BadRequestException(`Entry ${i}: amounts cannot be negative`);
      }
      if ((d > 0 && c > 0) || (d === 0 && c === 0)) {
        throw new BadRequestException(
          `Entry ${i}: exactly one of debit/credit must be a positive amount`,
        );
      }
      if (!e.accountCode) {
        throw new BadRequestException(`Entry ${i}: accountCode is required`);
      }
      debit += d;
      credit += c;
    }
    if (debit !== credit) {
      throw new BadRequestException(
        `Unbalanced transaction: debits ${debit} !== credits ${credit}`,
      );
    }
    if (debit === 0) {
      throw new BadRequestException('Transaction amount must be greater than zero');
    }
  }
}
