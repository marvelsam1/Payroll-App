import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.module';
import { SessionUser } from '../common/decorators';
import { Role } from '../generated/client';
import * as bcrypt from 'bcryptjs';

export interface CreateContractorInput {
  name: string;
  businessName?: string;
  email?: string;
  paymentTerms?: string;
  rateCents?: number;
  rateUnit?: string;
  createUser?: boolean;
  password?: string;
}

@Injectable()
export class ContractorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(companyId: string, q: { search?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 25));
    const where = {
      companyId,
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' as const } },
              { businessName: { contains: q.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.contractor.findMany({
        where,
        include: {
          _count: { select: { invoices: true } },
          user: { select: { id: true, email: true, role: true } },
        },
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.contractor.count({ where }),
    ]);
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getOne(companyId: string, id: string) {
    const contractor = await this.prisma.contractor.findFirst({
      where: { id, companyId },
      include: {
        invoices: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { transfers: true },
        },
      },
    });
    if (!contractor) throw new NotFoundException('Contractor not found');
    return contractor;
  }

  /** The contractor profile behind a contractor session (for /me style flows). */
  async byUserId(userId: string) {
    return this.prisma.contractor.findFirst({ where: { userId } });
  }

  async create(companyId: string, input: CreateContractorInput, actor: SessionUser) {
    let userId: string | undefined;
    if (input.createUser) {
      if (!input.email) throw new BadRequestException('email is required to create a user account');
      if (!input.password || input.password.length < 8) {
        throw new BadRequestException('password (min 8 chars) is required to create a user account');
      }
      const user = await this.prisma.user.create({
        data: {
          companyId,
          role: Role.CONTRACTOR,
          email: input.email.toLowerCase(),
          name: input.name,
          passwordHash: await bcrypt.hash(input.password, 10),
        },
      });
      userId = user.id;
    }

    const contractor = await this.prisma.contractor.create({
      data: {
        companyId,
        userId,
        name: input.name,
        businessName: input.businessName,
        email: input.email?.toLowerCase(),
        paymentTerms: input.paymentTerms ?? 'Net 15',
        rateCents: input.rateCents ?? 0,
        rateUnit: input.rateUnit ?? 'hourly',
      },
    });

    await this.audit.record({
      actor,
      companyId,
      action: 'contractor.created',
      entityType: 'Contractor',
      entityId: contractor.id,
      after: { name: contractor.name, businessName: contractor.businessName },
    });
    return contractor;
  }

  async update(companyId: string, id: string, patch: Partial<CreateContractorInput>, actor: SessionUser) {
    const existing = await this.prisma.contractor.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Contractor not found');
    const updated = await this.prisma.contractor.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.businessName !== undefined ? { businessName: patch.businessName } : {}),
        ...(patch.email !== undefined ? { email: patch.email.toLowerCase() } : {}),
        ...(patch.paymentTerms !== undefined ? { paymentTerms: patch.paymentTerms } : {}),
        ...(patch.rateCents !== undefined ? { rateCents: patch.rateCents } : {}),
        ...(patch.rateUnit !== undefined ? { rateUnit: patch.rateUnit } : {}),
      },
    });
    await this.audit.record({
      actor,
      companyId,
      action: 'contractor.updated',
      entityType: 'Contractor',
      entityId: id,
      before: { name: existing.name, rateCents: existing.rateCents, paymentTerms: existing.paymentTerms },
      after: { name: updated.name, rateCents: updated.rateCents, paymentTerms: updated.paymentTerms },
    });
    return updated;
  }
}
