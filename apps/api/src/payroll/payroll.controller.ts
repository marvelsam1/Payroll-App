import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';
import { Response } from 'express';
import * as fs from 'fs';
import { PayrollService } from './payroll.service';
import { CurrentUser, RequirePermissions, SessionUser } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';

class CreateRunDto {
  @IsISO8601() periodStart!: string;
  @IsISO8601() periodEnd!: string;
}

class RejectDto {
  @IsString() @MinLength(1) reason!: string;
}

class PreviewDto {
  @IsOptional() @IsISO8601() periodStart?: string;
  @IsOptional() @IsISO8601() periodEnd?: string;
}

class RunQueryDto {
  @IsOptional() @IsString() status?: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
}

/** Payroll run lifecycle: preview → draft → submit → approve → process. */
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('runs')
  @RequirePermissions(PERMISSIONS.payrollRead)
  list(@CurrentUser() s: SessionUser, @Query() q: RunQueryDto) {
    if (!s.companyId) return { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };
    return this.payroll.list(s, {
      status: q.status as any,
      page: q.page ? parseInt(q.page, 10) : undefined,
      pageSize: q.pageSize ? parseInt(q.pageSize, 10) : undefined,
    });
  }

  @Post('preview')
  @RequirePermissions(PERMISSIONS.payrollRead)
  @HttpCode(200)
  preview(@CurrentUser() s: SessionUser, @Body() dto: PreviewDto) {
    if (!s.companyId) throw new NotFoundException('No company scope');
    const now = new Date();
    const periodEnd = dto.periodEnd ? new Date(dto.periodEnd) : now;
    const periodStart = dto.periodStart
      ? new Date(dto.periodStart)
      : new Date(periodEnd.getTime() - 14 * 86400000);
    return this.payroll.preview(s.companyId, periodStart, periodEnd);
  }

  @Post('runs')
  @RequirePermissions(PERMISSIONS.payrollCreate)
  @HttpCode(201)
  create(@CurrentUser() s: SessionUser, @Body() dto: CreateRunDto) {
    return this.payroll.createDraft(s, new Date(dto.periodStart), new Date(dto.periodEnd));
  }

  @Get('runs/:id')
  @RequirePermissions(PERMISSIONS.payrollRead)
  detail(@CurrentUser() s: SessionUser, @Param('id') id: string) {
    return this.payroll.detail(s, id);
  }

  @Post('runs/:id/submit')
  @RequirePermissions(PERMISSIONS.payrollCreate)
  submit(@CurrentUser() s: SessionUser, @Param('id') id: string) {
    return this.payroll.submit(s, id);
  }

  @Post('runs/:id/approve')
  @RequirePermissions(PERMISSIONS.payrollApprove)
  approve(@CurrentUser() s: SessionUser, @Param('id') id: string) {
    return this.payroll.approve(s, id);
  }

  @Post('runs/:id/reject')
  @RequirePermissions(PERMISSIONS.payrollApprove)
  reject(@CurrentUser() s: SessionUser, @Param('id') id: string, @Body() dto: RejectDto) {
    return this.payroll.reject(s, id, dto.reason);
  }

  @Post('runs/:id/process')
  @RequirePermissions(PERMISSIONS.payrollProcess)
  process(@CurrentUser() s: SessionUser, @Param('id') id: string) {
    return this.payroll.startProcess(s, id);
  }

  @Get('runs/:id/stubs/:employeeId/pdf')
  @RequirePermissions(PERMISSIONS.paystubsRead)
  async stub(
    @CurrentUser() s: SessionUser,
    @Param('id') runId: string,
    @Param('employeeId') employeeId: string,
    @Res() res: Response,
  ) {
    const file = await this.payroll.getStubFile(s, runId, employeeId);
    if (!fs.existsSync(file)) throw new NotFoundException('Pay stub not found');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="paystub-${runId}.pdf"`);
    fs.createReadStream(file).pipe(res);
  }

  @Get('my-paystubs')
  @RequirePermissions(PERMISSIONS.paystubsRead)
  myPaystubs(@CurrentUser() s: SessionUser) {
    return this.payroll.myPaystubs(s);
  }
}
