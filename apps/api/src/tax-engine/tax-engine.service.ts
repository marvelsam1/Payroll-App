import { Injectable } from '@nestjs/common';
import { calculateWithholding } from './engine';
import { TaxInput, TaxResult } from './types';
import { STATE_CONFIGS, STATE_CONFIGS as states } from './states';

/**
 * Thin stateless wrapper exposing the pure tax engine to Nest services.
 * Every method is side-effect free.
 */
@Injectable()
export class TaxEngineService {
  /** Simulated tax engine — not certified for real compliance. */
  calculate(input: TaxInput): TaxResult {
    return calculateWithholding(input);
  }

  /** Supported jurisdiction configurations (for transparency endpoints/UI). */
  supportedStates(): Array<{ code: string; name: string; type: string; reciprocalWith: string[] }> {
    return Object.values(STATE_CONFIGS).map((s) => ({
      code: s.code,
      name: s.name,
      type: s.type,
      reciprocalWith: s.reciprocalWith,
    }));
  }

  hasState(code: string): boolean {
    return (code ?? '').toUpperCase() in states;
  }
}
