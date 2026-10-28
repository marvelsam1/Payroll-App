import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { LedgerController } from './ledger.controller';
import { AuditModule } from '../audit/audit.module';

/**
 * Double-entry ledger module. All money-moving features (payroll, ACH,
 * contractors, expenses) post through LedgerService — no feature writes
 * ledger tables directly.
 */
@Module({
  imports: [AuditModule],
  controllers: [LedgerController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
