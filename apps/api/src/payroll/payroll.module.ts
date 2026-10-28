import { Module } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { PayrollController } from './payroll.controller';
import { PdfService } from './pdf.service';
import { LedgerModule } from '../ledger/ledger.module';
import { AchModule } from '../ach/ach.module';
import { TaxEngineModule } from '../tax-engine/tax-engine.module';

/**
 * Payroll run engine — pulls active employees, runs the tax engine, posts the
 * accrual journal through the ledger, and initiates per-employee ACH
 * transfers. Idempotent by construction (status guards + unique line items).
 */
@Module({
  imports: [LedgerModule, AchModule, TaxEngineModule],
  controllers: [PayrollController],
  providers: [PayrollService, PdfService],
  exports: [PayrollService, PdfService],
})
export class PayrollModule {}
