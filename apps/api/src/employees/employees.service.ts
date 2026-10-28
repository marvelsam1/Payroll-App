import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.module';
import { SessionUser } from '../common/decorators';
import { encryptSensitive, decryptSensitive } from '../common/crypto';
import { EmployeeStatus, EmploymentType, PayType, Role } from '../generated/client';
import { FilingStatus } from '../tax-engine/types';
import * as bcrypt from 'bcryptjs';

export interface EmployeeListQuery {
  search?: string;
  status?: EmployeeStatus;
  departmentId?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateEmployeeInput {
  name: string;
  email?: string;
  ssn: string;
  workState: string;
  residenceState: string;
  residenceCity?: string;
  filingStatus?: FilingStatus;
  employmentType?: EmploymentType;
  payType?: PayType;
  payRateCents: number;
  weeklyHours?: number;
  departmentId?: string;
  hireDate?: string;
  status?: EmployeeStatus;
  preTax401kBps?: number;
  healthInsuranceCents?: number;
  postTaxRothBps?: number;
  garnishmentCents?: number;
  additionalFederalWithholdingCents?: number;
  ptoBalanceDays?: number;
  createUser?: boolean;
  password?: string;
}

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private maskSsn(encrypted: string): string {
    try {
      const plain = decryptSensitive(encrypted);
      return `•••-••-${plain.slice(-4)}`;
    } catch {
      return '•••-••-••••';
    }
  }

  async list(companyId: string, q: EmployeeListQuery) {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 25));
    const where = {
      companyId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.departmentId ? { departmentId: q.departmentId } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' as const } },
              { email: { contains: q.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        include: {
          department: { select: { id: true, name: true } },
          user: { select: { id: true, email: true, role: true } },
        },
        orderBy: [{ name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.employee.count({ where }),
    ]);
    return {
      items: items.map((e) => ({ ...e, ssnEncrypted: undefined, ssnMasked: this.maskSsn(e.ssnEncrypted) })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getOne(companyId: string, id: string, session: SessionUser) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, companyId },
      include: {
        department: true,
        user: { select: { id: true, email: true, role: true } },
      },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const canSeeSsn =
      session.role === Role.COMPANY_ADMIN ||
      session.role === Role.HR_MANAGER ||
      session.role === Role.PLATFORM_ADMIN;
    let ssn: string | undefined;
    if (canSeeSsn) {
      try {
        ssn = decryptSensitive(employee.ssnEncrypted);
      } catch {
        ssn = undefined;
      }
    }
    const { ssnEncrypted, ...rest } = employee;
    return { ...rest, ssnMasked: this.maskSsn(ssnEncrypted), ...(ssn ? { ssn } : {}) };
  }

  async create(companyId: string, input: CreateEmployeeInput, actor: SessionUser) {
    if (input.departmentId) {
      const dept = await this.prisma.department.findFirst({
        where: { id: input.departmentId, companyId },
      });
      if (!dept) throw new BadRequestException('Unknown department');
    }

    let userId: string | undefined;
    if (input.createUser) {
      if (!input.email) throw new BadRequestException('email is required to create a user account');
      if (!input.password || input.password.length < 8) {
        throw new BadRequestException('password (min 8 chars) is required to create a user account');
      }
      const user = await this.prisma.user.create({
        data: {
          companyId,
          role: Role.EMPLOYEE,
          email: input.email.toLowerCase(),
          name: input.name,
          passwordHash: await bcrypt.hash(input.password, 10),
        },
      });
      userId = user.id;
    }

    const employee = await this.prisma.employee.create({
      data: {
        companyId,
        userId,
        name: input.name,
        email: input.email?.toLowerCase(),
        ssnEncrypted: encryptSensitive(input.ssn),
        workState: input.workState.toUpperCase(),
        residenceState: input.residenceState.toUpperCase(),
        residenceCity: input.residenceCity ?? null,
        filingStatus: input.filingStatus ?? 'SINGLE',
        employmentType: input.employmentType ?? 'FULL_TIME',
        payType: input.payType ?? 'SALARIED',
        payRateCents: input.payRateCents,
        weeklyHours: input.weeklyHours ?? 40,
        departmentId: input.departmentId ?? null,
        status: input.status ?? 'ACTIVE',
        hireDate: input.hireDate ? new Date(input.hireDate) : new Date(),
        preTax401kBps: input.preTax401kBps ?? 0,
        healthInsuranceCents: input.healthInsuranceCents ?? 0,
        postTaxRothBps: input.postTaxRothBps ?? 0,
        garnishmentCents: input.garnishmentCents ?? 0,
        additionalFederalWithholdingCents: input.additionalFederalWithholdingCents ?? 0,
        ptoBalanceDays: input.ptoBalanceDays ?? 15,
      },
      include: { department: true },
    });

    await this.audit.record({
      actor,
      companyId,
      action: 'employee.created',
      entityType: 'Employee',
      entityId: employee.id,
      after: { name: employee.name, workState: employee.workState, status: employee.status },
    });
    const { ssnEncrypted, ...safe } = employee;
    void ssnEncrypted;
    return { ...safe, ssnMasked: this.maskSsn(employee.ssnEncrypted) };
  }

  async update(
    companyId: string,
    id: string,
    patch: Partial<CreateEmployeeInput> & { status?: EmployeeStatus },
    actor: SessionUser,
  ) {
    const existing = await this.prisma.employee.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Employee not found');

    const data: Record<string, unknown> = {};
    const map: Array<[keyof CreateEmployeeInput, string]> = [
      ['name', 'name'],
      ['email', 'email'],
      ['workState', 'workState'],
      ['residenceState', 'residenceState'],
      ['residenceCity', 'residenceCity'],
      ['filingStatus', 'filingStatus'],
      ['employmentType', 'employmentType'],
      ['payType', 'payType'],
      ['payRateCents', 'payRateCents'],
      ['weeklyHours', 'weeklyHours'],
      ['departmentId', 'departmentId'],
      ['status', 'status'],
      ['preTax401kBps', 'preTax401kBps'],
      ['healthInsuranceCents', 'healthInsuranceCents'],
      ['postTaxRothBps', 'postTaxRothBps'],
      ['garnishmentCents', 'garnishmentCents'],
      ['additionalFederalWithholdingCents', 'additionalFederalWithholdingCents'],
      ['ptoBalanceDays', 'ptoBalanceDays'],
    ];
    for (const [key, column] of map) {
      const value = (patch as any)[key];
      if (value !== undefined) {
        data[column] = typeof value === 'string' && ['workState', 'residenceState'].includes(column)
          ? value.toUpperCase()
          : value;
      }
    }
    if (patch.ssn) data.ssnEncrypted = encryptSensitive(patch.ssn);
    if (patch.hireDate) data.hireDate = new Date(patch.hireDate);
    if (patch.status === 'TERMINATED') data.terminationDate = new Date();

    const updated = await this.prisma.employee.update({
      where: { id },
      data,
      include: { department: true },
    });

    await this.audit.record({
      actor,
      companyId,
      action: 'employee.updated',
      entityType: 'Employee',
      entityId: id,
      before: {
        name: existing.name,
        status: existing.status,
        payRateCents: existing.payRateCents,
        workState: existing.workState,
        residenceState: existing.residenceState,
        departmentId: existing.departmentId,
      },
      after: {
        name: updated.name,
        status: updated.status,
        payRateCents: updated.payRateCents,
        workState: updated.workState,
        residenceState: updated.residenceState,
        departmentId: updated.departmentId,
      },
    });

    const { ssnEncrypted, ...safe } = updated;
    void ssnEncrypted;
    return { ...safe, ssnMasked: this.maskSsn(updated.ssnEncrypted) };
  }

  /** Soft-delete: termination is the only supported removal (keeps history). */
  async terminate(companyId: string, id: string, actor: SessionUser) {
    const existing = await this.prisma.employee.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Employee not found');
    if (existing.status === 'TERMINATED') return this.getOne(companyId, id, actor);
    return this.update(companyId, id, { status: 'TERMINATED' }, actor);
  }
}
