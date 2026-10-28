import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { CompaniesService } from './companies.service';
import { CurrentUser, RequirePermissions, SessionUser } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';
import { Role } from '../generated/client';
import * as bcrypt from 'bcryptjs';

class CreateCompanyDto {
  @IsString() @MinLength(2) name!: string;
  @IsString() ein!: string;
  @IsOptional() @IsString() paySchedule?: 'WEEKLY' | 'BIWEEKLY' | 'SEMIMONTHLY' | 'MONTHLY';
  @IsOptional() @IsString() defaultState?: string;
  @IsOptional() @IsInt() @Min(0) monthlyRevenueCents?: number;
  @IsOptional() @IsInt() @Min(0) startingBalanceCents?: number;
  @IsOptional() @IsString() bankName?: string;
  @IsOptional() @IsString() routingNumber?: string;
  @IsOptional() @IsString() accountNumber?: string;
  @IsOptional() @IsObject() admin?: { email: string; name: string; passwordHash: string };
}

class UpdateCompanyDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() ein?: string;
  @IsOptional() @IsString() paySchedule?: 'WEEKLY' | 'BIWEEKLY' | 'SEMIMONTHLY' | 'MONTHLY';
  @IsOptional() @IsString() defaultState?: string;
  @IsOptional() @IsInt() @Min(0) monthlyRevenueCents?: number;
  @IsOptional() @IsBoolean() chaosMode?: boolean;
}

class AdminUserDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(2) name!: string;
  @IsString() @MinLength(8) password!: string;
}

class CreateCompanyWithAdminDto extends CreateCompanyDto {
  @IsOptional() @IsObject() adminUser?: AdminUserDto;
}

class BankAccountDto {
  @IsOptional() @IsString() bankName?: string;
  @IsOptional() @IsString() routingNumber?: string;
  @IsOptional() @IsString() accountNumber?: string;
}

class ChaosDto {
  @IsBoolean() enabled!: boolean;
}

/** Company (tenant) management. Platform admin manages all tenants. */
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.platformManage)
  @HttpCode(201)
  async create(@CurrentUser() actor: SessionUser, @Body() dto: CreateCompanyWithAdminDto) {
    const { adminUser, ...rest } = dto;
    return this.companies.create(
      {
        ...rest,
        paySchedule: rest.paySchedule as any,
        admin: adminUser
          ? {
              email: adminUser.email,
              name: adminUser.name,
              passwordHash: await hashPassword(adminUser.password),
            }
          : undefined,
      },
      actor,
    );
  }

  @Get()
  @RequirePermissions(PERMISSIONS.platformManage)
  list() {
    return this.companies.list();
  }

  @Get('me')
  @RequirePermissions(PERMISSIONS.companyRead)
  me(@CurrentUser() s: SessionUser) {
    if (!s.companyId) throw new BadRequestException('Platform admins have no default company');
    return this.companies.getById(s.companyId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.companyRead)
  getOne(@CurrentUser() s: SessionUser, @Param('id') id: string) {
    this.assertScope(s, id);
    return this.companies.getById(id);
  }

  @Patch('me')
  @RequirePermissions(PERMISSIONS.companyWrite)
  updateMe(@CurrentUser() s: SessionUser, @Body() dto: UpdateCompanyDto) {
    if (!s.companyId) throw new BadRequestException('Platform admins have no default company');
    return this.companies.update(s.companyId, dto as any, s);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.companyWrite)
  update(
    @CurrentUser() s: SessionUser,
    @Param('id') id: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    this.assertScope(s, id);
    return this.companies.update(id, dto as any, s);
  }

  @Post('me/bank-account')
  @RequirePermissions(PERMISSIONS.settingsWrite)
  bankAccount(@CurrentUser() s: SessionUser, @Body() dto: BankAccountDto) {
    if (!s.companyId) throw new BadRequestException('Platform admins have no default company');
    return this.companies.updateBankAccount(s.companyId, dto, s);
  }

  @Post('me/chaos-mode')
  @RequirePermissions(PERMISSIONS.settingsWrite)
  chaos(@CurrentUser() s: SessionUser, @Body() dto: ChaosDto) {
    if (!s.companyId) throw new BadRequestException('Platform admins have no default company');
    return this.companies.setChaosMode(s.companyId, dto.enabled, s);
  }

  private assertScope(s: SessionUser, id: string): void {
    if (s.companyId) {
      // Tenant sessions can never address another tenant — 404 (no leaking).
      if (s.companyId !== id) throw new NotFoundException('Company not found');
    } else if (s.role !== Role.PLATFORM_ADMIN) {
      throw new NotFoundException('Company not found');
    }
  }
}

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}
