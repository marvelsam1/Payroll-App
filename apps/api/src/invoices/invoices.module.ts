import { Module } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { LedgerModule } from '../ledger/ledger.module';
import { AchModule } from '../ach/ach.module';

@Module({
  imports: [LedgerModule, AchModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
