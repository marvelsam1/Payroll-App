import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { IsArray, IsInt, IsISO8601, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { InvoicesService } from './invoices.service';
import { CurrentUser, RequirePermissions, SessionUser } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';

class SubmitInvoiceDto {
  @IsString() @MinLength(1) description!: string;
  @IsInt() @Min(1) amountCents!: number;
  @IsISO8601() periodStart!: string;
  @IsISO8601() periodEnd!: string;
}

class RejectInvoiceDto {
  @IsString() @MinLength(1) reason!: string;
}

class PayBatchDto {
  @IsArray() @IsString({ each: true }) invoiceIds!: string[];
}

class InvoiceQueryDto {
  @IsOptional() @IsString() status?: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'PAID';
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
}

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.invoicesRead)
  list(@CurrentUser() s: SessionUser, @Query() q: InvoiceQueryDto) {
    if (!s.companyId && s.role !== 'PLATFORM_ADMIN') {
      return { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };
    }
    return this.invoices.list(s, {
      status: q.status as any,
      page: q.page ? parseInt(q.page, 10) : undefined,
      pageSize: q.pageSize ? parseInt(q.pageSize, 10) : undefined,
    });
  }

  @Post()
  @RequirePermissions(PERMISSIONS.invoicesSubmit)
  @HttpCode(201)
  submit(@CurrentUser() s: SessionUser, @Body() dto: SubmitInvoiceDto) {
    return this.invoices.submit(s, {
      amountCents: Number(dto.amountCents),
      description: dto.description,
      periodStart: dto.periodStart,
      periodEnd: dto.periodEnd,
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.invoicesRead)
  getOne(@CurrentUser() s: SessionUser, @Param('id') id: string) {
    return this.invoices.getOne(s, id);
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.invoicesApprove)
  approve(@CurrentUser() s: SessionUser, @Param('id') id: string) {
    return this.invoices.approve(s, id);
  }

  @Post(':id/reject')
  @RequirePermissions(PERMISSIONS.invoicesApprove)
  reject(@CurrentUser() s: SessionUser, @Param('id') id: string, @Body() dto: RejectInvoiceDto) {
    return this.invoices.reject(s, id, dto.reason);
  }

  @Post('pay-batch')
  @RequirePermissions(PERMISSIONS.invoicesPay)
  payBatch(@CurrentUser() s: SessionUser, @Body() dto: PayBatchDto) {
    return this.invoices.payBatch(s, dto.invoiceIds);
  }
}
