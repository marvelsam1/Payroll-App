import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { AchService, FAILURE_CODE_MEANING } from './ach.service';
import { CurrentUser, RequirePermissions, SessionUser } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';

class RetryDto {
  @IsString() @MinLength(1) reason?: string;
}

class TransferQueryDto {
  @IsOptional() @IsString() status?: 'INITIATED' | 'PENDING' | 'PROCESSING' | 'SETTLED' | 'FAILED';
  @IsOptional() @IsString() payrollRunId?: string;
  @IsOptional() @IsString() invoiceId?: string;
  @IsOptional() @IsString() employeeId?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
}

/** Simulated ACH transfers: listing, detail, retry. */
@Controller('transfers')
export class AchController {
  constructor(private readonly ach: AchService) {}

  @Get('failure-codes')
  @RequirePermissions(PERMISSIONS.transfersRead)
  failureCodes() {
    return Object.entries(FAILURE_CODE_MEANING).map(([code, meaning]) => ({ code, meaning }));
  }

  @Get()
  @RequirePermissions(PERMISSIONS.transfersRead)
  list(@CurrentUser() s: SessionUser, @Query() q: TransferQueryDto) {
    if (!s.companyId) return { items: [], total: 0, page: 1, pageSize: 25, totalPages: 0 };
    return this.ach.list(s.companyId, {
      status: q.status as any,
      payrollRunId: q.payrollRunId,
      invoiceId: q.invoiceId,
      employeeId: q.employeeId,
      page: q.page ? parseInt(q.page, 10) : undefined,
      pageSize: q.pageSize ? parseInt(q.pageSize, 10) : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.transfersRead)
  getOne(@CurrentUser() s: SessionUser, @Param('id') id: string) {
    if (!s.companyId) throw new Error('No company scope');
    return this.ach.getOne(s.companyId, id);
  }

  @Post(':id/retry')
  @RequirePermissions(PERMISSIONS.transfersManage)
  @HttpCode(201)
  retry(@CurrentUser() s: SessionUser, @Param('id') id: string, @Body() _dto: RetryDto) {
    return this.ach.retry(s, id);
  }
}
