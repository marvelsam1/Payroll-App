import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { ComplianceService } from './compliance.service';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, RequirePermissions, SessionUser } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';

function companyOf(s: SessionUser, explicit?: string): string {
  return s.companyId ?? explicit ?? '';
}

/** Compliance calendar, jurisdiction checks, watermarked filing mockups. */
@Controller('compliance')
export class ComplianceController {
  constructor(
    private readonly compliance: ComplianceService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('calendar')
  @RequirePermissions(PERMISSIONS.complianceRead)
  calendar(@CurrentUser() s: SessionUser, @Query('year') year?: string) {
    const companyId = companyOf(s);
    const y = year ? parseInt(year, 10) : new Date().getFullYear();
    return this.compliance.calendar(companyId, y);
  }

  @Get('jurisdiction-check')
  @RequirePermissions(PERMISSIONS.complianceRead)
  jurisdiction(@CurrentUser() s: SessionUser) {
    return this.compliance.jurisdictionCheck(companyOf(s));
  }

  @Get('states')
  @RequirePermissions(PERMISSIONS.complianceRead)
  states() {
    return {
      states: [
        { code: 'CA', type: 'progressive' },
        { code: 'TX', type: 'none' },
        { code: 'PA', type: 'flat' },
        { code: 'NY', type: 'progressive + NYC local' },
        { code: 'NJ', type: 'progressive' },
      ],
      reciprocalPairs: [['NJ', 'NY']],
      frequencies: this.compliance.supportedFrequencies(),
      disclaimer: 'Simulated tax engine — not certified for real compliance',
    };
  }

  @Get('forms/941')
  @RequirePermissions(PERMISSIONS.complianceGenerate)
  async form941(
    @CurrentUser() s: SessionUser,
    @Res() res: Response,
    @Query('periodStart') periodStart?: string,
    @Query('periodEnd') periodEnd?: string,
  ) {
    const end = periodEnd ? new Date(periodEnd) : new Date();
    const start = periodStart ? new Date(periodStart) : new Date(end.getFullYear(), Math.floor(end.getMonth() / 3) * 3, 1);
    const pdf = await this.compliance.form941(companyOf(s), start.toISOString(), end.toISOString());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="form-941-simulated.pdf"');
    res.send(Buffer.from(pdf));
  }

  @Get('forms/w2')
  @RequirePermissions(PERMISSIONS.complianceGenerate)
  async formW2(
    @CurrentUser() s: SessionUser,
    @Res() res: Response,
    @Query('employeeId') employeeId?: string,
    @Query('year') year?: string,
  ) {
    const pdf = await this.compliance.formW2(
      companyOf(s),
      employeeId ?? '',
      year ? parseInt(year, 10) : new Date().getFullYear() - 1,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="form-w2-simulated.pdf"');
    res.send(Buffer.from(pdf));
  }

  @Get('forms/suta')
  @RequirePermissions(PERMISSIONS.complianceGenerate)
  async formSuta(
    @CurrentUser() s: SessionUser,
    @Res() res: Response,
    @Query('year') year?: string,
    @Query('quarter') quarter?: string,
    @Query('state') state?: string,
  ) {
    const pdf = await this.compliance.formSuta(
      companyOf(s),
      year ? parseInt(year, 10) : new Date().getFullYear(),
      quarter ? parseInt(quarter, 10) : Math.floor(new Date().getMonth() / 3) + 1,
      state,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="form-suta-simulated.pdf"');
    res.send(Buffer.from(pdf));
  }

  /** Employees eligible for a W-2 (for the compliance UI dropdown). */
  @Get('w2-employees')
  @RequirePermissions(PERMISSIONS.complianceRead)
  async w2Employees(@CurrentUser() s: SessionUser) {
    return this.prisma.employee.findMany({
      where: { companyId: companyOf(s), status: { not: 'TERMINATED' } },
      select: { id: true, name: true, workState: true, residenceState: true },
      orderBy: { name: 'asc' },
      take: 200,
    });
  }
}
