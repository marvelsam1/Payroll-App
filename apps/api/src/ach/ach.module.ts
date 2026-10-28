import { Module } from '@nestjs/common';
import { AchService } from './ach.service';
import { AchController } from './ach.controller';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [LedgerModule],
  controllers: [AchController],
  providers: [AchService],
  exports: [AchService],
})
export class AchModule {}
