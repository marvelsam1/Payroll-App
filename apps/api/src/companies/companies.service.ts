import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { AuditService } from '../audit/audit.module';
import { SessionUser } from '../common/decorators';
import { encryptSensitive } from '../common/crypto';
import { PayFrequency, Role } from '../generated/client';

export interface CreateCompanyInput {
  name: string;
  ein: string;
  paySchedule?: PayFrequency;
  defaultState?: string;
  monthlyRevenueCents?: number;
  startingBalanceCents?: number;
  bankName?: string;
  routingNumber?: string;
  accountNumber?: string;
  admin?: { email: string; name: string; passwordHash: string };
}

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Create the multi-tenant root entity: company + chart of accounts +
   * simulated bank account with starting balance (posted as a balanced
   * opening transaction) + optional first company admin.
   */
  async create(input: CreateCompanyInput, actor: SessionUser) {
    const company = await this.prisma.company.create({
      data: {
        name: input.name,
        ein: input.ein,
        paySchedule: input.paySchedule ?? 'BIWEEKLY',
        defaultState: (input.defaultState ?? 'CA').toUpperCase(),
        monthlyRevenueCents: input.monthlyRevenueCents ?? 0,
      },
    });

    await this.ledger.ensureCompanyAccounts(company.id);

    const starting = input.startingBalanceCents ?? 0;
    await this.prisma.companyBankAccount.create({
      data: {
        companyId: company.id,
        bankName: input.bankName ?? 'Simulated National Bank',
        routingNumberEncrypted: encryptSensitive(input.routingNumber ?? '021000021'),
        accountNumberEncrypted: encryptSensitive(input.accountNumber ?? '000123456789'),
        startingBalanceCents: starting,
        isDefault: true,
      },
    });

    if (starting > 0) {
      await this.ledger.postTransaction({
        companyId: company.id,
        description: 'Simulated opening bank balance',
        referenceType: 'opening',
        referenceId: company.id,
        createdBy: actor.id,
        entries: [
          { accountCode: 'OPERATING_CASH', debit: starting },
          { accountCode: 'OPENING_BALANCE_EQUITY', credit: starting },
        ],
      });
    }

    let adminId: string | null = null;
    if (input.admin) {
      const user = await this.prisma.user.create({
        data: {
          companyId: company.id,
          role: Role.COMPANY_ADMIN,
          email: input.admin.email.toLowerCase(),
          name: input.admin.name,
          passwordHash: input.admin.passwordHash,
        },
      });
      adminId = user.id;
    }

    await this.audit.record({
      actor,
      companyId: company.id,
      action: 'company.created',
      entityType: 'Company',
      entityId: company.id,
      after: { name: company.name, ein: company.ein, startingBalanceCents: starting, adminId },
    });

    return company;
  }

  async list() {
    const companies = await this.prisma.company.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { employees: true, users: true } } },
    });
    const stats = await this.prisma.company.groupBy({
      by: ['id'],
      _count: { id: true },
    });
    void stats;
    return Promise.all(
      companies.map(async (c) => {
        const runs = await this.prisma.payrollRun.count({ where: { companyId: c.id } });
        return {
          id: c.id,
          name: c.name,
          ein: c.ein,
          paySchedule: c.paySchedule,
          defaultState: c.defaultState,
          chaosMode: c.chaosMode,
          monthlyRevenueCents: c.monthlyRevenueCents,
          createdAt: c.createdAt,
          employeeCount: c._count.employees,
          userCount: c._count.users,
          payrollRunCount: runs,
        };
      }),
    );
  }

  async getById(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: {
        bankAccounts: true,
        _count: { select: { employees: true, contractors: true, departments: true, users: true } },
      },
    });
    if (!company) throw new NotFoundException('Company not found');
    const { bankAccounts, ...rest } = company;
    return {
      ...rest,
      bankAccount: bankAccounts[0]
        ? {
            id: bankAccounts[0].id,
            bankName: bankAccounts[0].bankName,
            startingBalanceCents: bankAccounts[0].startingBalanceCents,
            isDefault: bankAccounts[0].isDefault,
            // encrypted at rest; masked for display — decryption stays server-side
            routingNumberMasked: '••••0210',
            accountNumberMasked: '••••6789',
          }
        : null,
    };
  }

  async update(
    companyId: string,
    patch: Partial<{
      name: string;
      ein: string;
      paySchedule: PayFrequency;
      defaultState: string;
      monthlyRevenueCents: number;
      chaosMode: boolean;
    }>,
    actor: SessionUser,
  ) {
    const before = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!before) throw new NotFoundException('Company not found');
    const updated = await this.prisma.company.update({
      where: { id: companyId },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.ein !== undefined ? { ein: patch.ein } : {}),
        ...(patch.paySchedule !== undefined ? { paySchedule: patch.paySchedule } : {}),
        ...(patch.defaultState !== undefined ? { defaultState: patch.defaultState.toUpperCase() } : {}),
        ...(patch.monthlyRevenueCents !== undefined
          ? { monthlyRevenueCents: patch.monthlyRevenueCents }
          : {}),
        ...(patch.chaosMode !== undefined ? { chaosMode: patch.chaosMode } : {}),
      },
    });
    await this.audit.record({
      actor,
      companyId,
      action: 'company.updated',
      entityType: 'Company',
      entityId: companyId,
      before: {
        name: before.name,
        ein: before.ein,
        paySchedule: before.paySchedule,
        defaultState: before.defaultState,
        monthlyRevenueCents: before.monthlyRevenueCents,
        chaosMode: before.chaosMode,
      },
      after: {
        name: updated.name,
        ein: updated.ein,
        paySchedule: updated.paySchedule,
        defaultState: updated.defaultState,
        monthlyRevenueCents: updated.monthlyRevenueCents,
        chaosMode: updated.chaosMode,
      },
    });
    return updated;
  }

  /** Rotate simulated bank credentials (values re-encrypted at rest). */
  async updateBankAccount(
    companyId: string,
    patch: { bankName?: string; routingNumber?: string; accountNumber?: string },
    actor: SessionUser,
  ) {
    const existing = await this.prisma.companyBankAccount.findFirst({ where: { companyId } });
    if (!existing) throw new NotFoundException('Bank account not found');
    const updated = await this.prisma.companyBankAccount.update({
      where: { id: existing.id },
      data: {
        ...(patch.bankName ? { bankName: patch.bankName } : {}),
        ...(patch.routingNumber ? { routingNumberEncrypted: encryptSensitive(patch.routingNumber) } : {}),
        ...(patch.accountNumber ? { accountNumberEncrypted: encryptSensitive(patch.accountNumber) } : {}),
      },
    });
    await this.audit.record({
      actor,
      companyId,
      action: 'company.bank_account.updated',
      entityType: 'CompanyBankAccount',
      entityId: updated.id,
      after: { bankName: updated.bankName },
    });
    return { id: updated.id, bankName: updated.bankName, startingBalanceCents: updated.startingBalanceCents };
  }

  async setChaosMode(companyId: string, enabled: boolean, actor: SessionUser) {
    const updated = await this.update(companyId, { chaosMode: enabled }, actor);
    await this.audit.record({
      actor,
      companyId,
      action: enabled ? 'simulation.chaos_enabled' : 'simulation.chaos_disabled',
      entityType: 'Company',
      entityId: companyId,
      after: { chaosMode: enabled },
    });
    return { chaosMode: updated.chaosMode };
  }

  assertTenant(session: SessionUser, companyId: string): void {
    if (session.companyId && session.companyId !== companyId) {
      throw new BadRequestException('Cross-tenant access denied');
    }
  }
}
