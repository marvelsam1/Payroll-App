import { Module } from '@nestjs/common';
import { TaxEngineService } from './tax-engine.service';

/**
 * Tax engine module. The calculation itself lives in pure functions
 * (engine.ts, federal.ts, fica.ts, states.ts) so it can be unit-tested in
 * isolation with 90%+ coverage; the service exposes it to the rest of the API.
 */
@Module({
  providers: [TaxEngineService],
  exports: [TaxEngineService],
})
export class TaxEngineModule {}
