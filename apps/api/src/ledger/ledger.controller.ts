import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { IsArray, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { LedgerService, PostEntryInput } from './ledger.service';
import { CurrentUser, RequirePermissions, SessionUser } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';
import { Role } from '../generated/client';

class CreateTransactionDto {
  @IsString()
  description!: string;

  @IsOptional()
  @IsString()
  referenceType?: string;

  @IsOptional()
  @IsString()
  referenceId?: string;

  @IsOptional()
  @IsString()
  companyId?: string; // platform admin only

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EntryDto)
  entries!: EntryDto[];
}

class EntryDto implements PostEntryInput {
  @IsString()
  accountCode!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  debit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  credit?: number;

  @IsOptional()
  @IsString()
  relatedEntityType?: string;

  @IsOptional()
  @IsString()
  relatedEntityId?: string;
}

class ReverseDto {
  @IsString()
  reason!: string;
}

class EntryQueryDto {
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() referenceType?: string;
  @IsOptional() @IsString() relatedEntityType?: string;
  @IsOptional() @IsString() relatedEntityId?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
  @IsOptional() @IsString() companyId?: string;
}

function resolveCompany(session: SessionUser, explicit?: string): string {
  if (session.companyId) {
    if (explicit && explicit !== session.companyId) {
      throw new NotFoundException('Transaction not found');
    }
    return session.companyId;
  }
  if (session.role === Role.PLATFORM_ADMIN && explicit) return explicit;
  throw new NotFoundException('No company scope');
}

/** Ledger viewer + reversal endpoints (read for accountants, reverse for admins). */
@Controller('ledger')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('accounts')
  @RequirePermissions(PERMISSIONS.ledgerRead)
  accounts(@CurrentUser() s: SessionUser, @Query('companyId') companyId?: string) {
    return this.ledger.getAccountBalances(resolveCompany(s, companyId));
  }

  @Get('entries')
  @RequirePermissions(PERMISSIONS.ledgerRead)
  entries(@CurrentUser() s: SessionUser, @Query() q: EntryQueryDto) {
    return this.ledger.listEntries(resolveCompany(s, q.companyId), {
      accountId: q.accountId,
      from: q.from,
      to: q.to,
      referenceType: q.referenceType,
      relatedEntityType: q.relatedEntityType,
      relatedEntityId: q.relatedEntityId,
      search: q.search,
      page: q.page ? parseInt(q.page, 10) : undefined,
      pageSize: q.pageSize ? parseInt(q.pageSize, 10) : undefined,
    });
  }

  @Get('trial-balance')
  @RequirePermissions(PERMISSIONS.ledgerRead)
  trialBalance(@CurrentUser() s: SessionUser, @Query('companyId') companyId?: string) {
    return this.ledger.trialBalance(resolveCompany(s, companyId));
  }

  @Get('validate')
  @RequirePermissions(PERMISSIONS.ledgerRead)
  validate(@CurrentUser() s: SessionUser, @Query('companyId') companyId?: string) {
    return this.ledger.validateInvariants(resolveCompany(s, companyId));
  }

  @Post('transactions')
  @RequirePermissions(PERMISSIONS.ledgerReverse)
  @HttpCode(201)
  post(@CurrentUser() s: SessionUser, @Body() dto: CreateTransactionDto) {
    return this.ledger.postTransaction({
      companyId: resolveCompany(s, dto.companyId),
      description: dto.description,
      referenceType: dto.referenceType,
      referenceId: dto.referenceId,
      createdBy: s.id,
      entries: dto.entries,
    });
  }

  @Post('transactions/:id/reverse')
  @RequirePermissions(PERMISSIONS.ledgerReverse)
  @HttpCode(201)
  reverse(
    @CurrentUser() s: SessionUser,
    @Param('id') id: string,
    @Body() dto: ReverseDto,
  ) {
    return this.ledger.reverseTransaction(resolveCompany(s), id, {
      actor: s,
      reason: dto.reason,
    });
  }
}
