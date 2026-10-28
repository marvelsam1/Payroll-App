import {
  calculateWithholding,
  FEDERAL_BRACKETS_2024,
  FEDERAL_STANDARD_DEDUCTION_2024,
  computeFica,
  computeStateTax,
  federalAnnualTaxable,
  federalTaxForPeriod,
  getStateConfig,
  isReciprocal,
  PERIODS_PER_YEAR,
  roundCents,
  SS_WAGE_BASE_2024,
  stateIncomeTax,
  STATE_CONFIGS,
  taxFromBrackets,
  TaxInput,
} from './index';
import { TaxEngineService } from './tax-engine.service';

/**
 * Tax engine unit tests — hand-computed expectations against published
 * 2024 parameters (IRS Pub. 15-T / state schedules). Simulated engine:
 * these tests pin the SIMULATION's arithmetic, not IRS-certified output.
 */

const base = (over: Partial<TaxInput> = {}): TaxInput => ({
  grossPayCents: 200_000, // $2,000 biweekly
  frequency: 'BIWEEKLY',
  filingStatus: 'SINGLE',
  workState: 'TX',
  residenceState: 'TX',
  ...over,
});

describe('tax engine — federal (2024 percentage method)', () => {
  it('computes the full check for a TX single filer (no state tax)', () => {
    const r = calculateWithholding(base());
    // annual $52,000 − $14,600 std = $37,400 taxable
    // 10% of $11,600 = $1,160 + 12% of $25,800 = $3,096 → $4,256/yr → /26
    expect(r.federalTaxCents).toBe(16_369);
    expect(r.ficaSsCents).toBe(12_400); // 6.2% of $2,000
    expect(r.ficaMedicareCents).toBe(2_900); // 1.45% of $2,000
    expect(r.stateTaxCents).toBe(0);
    expect(r.netPayCents).toBe(168_331);
    expect(r.employerFicaSsCents).toBe(12_400);
    expect(r.employerFicaMedicareCents).toBe(2_900);
  });

  it('pins bracket boundary math via taxFromBrackets', () => {
    const s = FEDERAL_BRACKETS_2024.SINGLE;
    expect(taxFromBrackets(0, s)).toBe(0);
    expect(taxFromBrackets(-5, s)).toBe(0);
    expect(taxFromBrackets(1_160_000, s)).toBe(116_000); // exactly 10% ceiling
    expect(taxFromBrackets(1_161_000, s)).toBe(116_120); // +1,000 at 12%
    expect(taxFromBrackets(4_715_000, s)).toBe(542_600); // end of 12% band
    expect(taxFromBrackets(100_000_000, s)).toBe(32_818_775); // top 37% band
    expect(taxFromBrackets(2_320_000, FEDERAL_BRACKETS_2024.MARRIED_JOINTLY)).toBe(232_000);
    // Doubling both income and thresholds doubles the tax (MFJ ≈ 2 × single)
    expect(2 * taxFromBrackets(100_000_000, FEDERAL_BRACKETS_2024.MARRIED_FILING_SEPARATELY)).toBe(
      taxFromBrackets(200_000_000, FEDERAL_BRACKETS_2024.MARRIED_JOINTLY),
    );
  });

  it('applies the standard deduction by filing status', () => {
    expect(FEDERAL_STANDARD_DEDUCTION_2024.SINGLE).toBe(1_460_000);
    expect(FEDERAL_STANDARD_DEDUCTION_2024.MARRIED_JOINTLY).toBe(2_920_000);
    const annualable = federalAnnualTaxable({
      grossPayCents: 100_000,
      preTaxDeductionsCents: 0,
      periodsPerYear: 12,
      filingStatus: 'SINGLE',
    });
    expect(annualable).toBe(0); // $12k annual < $14,600 standard deduction
    expect(
      federalAnnualTaxable({
        grossPayCents: 500_000,
        preTaxDeductionsCents: 10_000,
        periodsPerYear: 12,
        filingStatus: 'MARRIED_JOINTLY',
      }),
    ).toBe(6_000_000 - 120_000 - 2_920_000);
  });

  it('de-annualizes per frequency and adds additional withholding', () => {
    expect(PERIODS_PER_YEAR).toEqual({
      WEEKLY: 52,
      BIWEEKLY: 26,
      SEMIMONTHLY: 24,
      MONTHLY: 12,
    });
    const weekly = federalTaxForPeriod({
      grossPayCents: 100_000,
      preTaxDeductionsCents: 0,
      additionalWithholdingCents: 0,
      periodsPerYear: 52,
      filingStatus: 'SINGLE',
    });
    const withExtra = federalTaxForPeriod({
      grossPayCents: 100_000,
      preTaxDeductionsCents: 0,
      additionalWithholdingCents: 5_000,
      periodsPerYear: 52,
      filingStatus: 'SINGLE',
    });
    expect(withExtra - weekly).toBe(5_000);
    // $1,000/week annualizes to $52,000 — standard deduction wipes out most of it
    expect(weekly).toBe(8_185); // annual $52,000 → $4,256 tax → /52
  });

  it('reduces federal tax for pre-tax deductions only', () => {
    const without = calculateWithholding(base());
    const withPre = calculateWithholding(base({ preTaxDeductionsCents: 10_000 }));
    // annual taxable drops $260k cents → 12% band → /26
    expect(withPre.federalTaxCents).toBe(15_169);
    expect(without.federalTaxCents - withPre.federalTaxCents).toBe(1_200);
    // FICA is calculated on gross — pre-tax 401(k) does NOT reduce FICA
    expect(withPre.ficaSsCents).toBe(without.ficaSsCents);
    expect(withPre.netPayCents).toBe(without.netPayCents - 10_000 + 1_200); // −deduction +tax saved
    expect(withPre.taxableWagesCents).toBe(190_000);
  });

  it('post-tax deductions reduce net only', () => {
    const without = calculateWithholding(base());
    const withPost = calculateWithholding(base({ postTaxDeductionsCents: 5_000 }));
    expect(withPost.federalTaxCents).toBe(without.federalTaxCents);
    expect(withPost.ficaSsCents).toBe(without.ficaSsCents);
    expect(withPost.netPayCents).toBe(without.netPayCents - 5_000);
    expect(withPost.postTaxDeductionsCents).toBe(5_000);
  });
});

describe('tax engine — FICA', () => {
  it('stops Social Security at the wage base mid-year', () => {
    const r = calculateWithholding(base({ ytdGrossCents: 16_800_000 }));
    // $600 of the $2,000 check remains under the $168,600 base
    expect(r.ficaSsCents).toBe(3_720);
    expect(r.meta.ssTaxableCents).toBe(60_000);
    expect(r.ficaMedicareCents).toBe(2_900); // uncapped
  });

  it('zeroes Social Security once the base is exhausted', () => {
    const r = calculateWithholding(base({ ytdGrossCents: SS_WAGE_BASE_2024 }));
    expect(r.ficaSsCents).toBe(0);
    expect(r.meta.ssTaxableCents).toBe(0);
  });

  it('applies Additional Medicare over the filing-status threshold', () => {
    const single = computeFica({ grossPayCents: 200_000, filingStatus: 'SINGLE', ytdGrossCents: 19_900_000 });
    expect(single.ficaMedicareCents).toBe(2_900 + 900); // 0.9% on the $1,000 slice
    expect(single.additionalMedicareApplies).toBe(true);
    expect(single.employerFicaMedicareCents).toBe(2_900); // employer never pays add'l

    const mfj = computeFica({ grossPayCents: 200_000, filingStatus: 'MARRIED_JOINTLY', ytdGrossCents: 24_900_000 });
    expect(mfj.ficaMedicareCents).toBe(2_900 + 900);

    const mfs = computeFica({ grossPayCents: 200_000, filingStatus: 'MARRIED_FILING_SEPARATELY', ytdGrossCents: 12_400_000 });
    expect(mfs.ficaMedicareCents).toBe(2_900 + 900);

    const under = computeFica({ grossPayCents: 200_000, filingStatus: 'SINGLE', ytdGrossCents: 19_000_000 });
    expect(under.additionalMedicareApplies).toBe(false);
    expect(under.ficaMedicareCents).toBe(2_900);
  });
});

describe('tax engine — state configurations', () => {
  it('TX has no income tax', () => {
    const r = calculateWithholding(base({ workState: 'TX', residenceState: 'TX' }));
    expect(r.stateTaxCents).toBe(0);
    expect(r.meta.stateType).toBe('none');
    expect(getStateConfig('TX')?.type).toBe('none');
  });

  it('PA withholds the flat 3.07%', () => {
    const r = calculateWithholding(
      base({ grossPayCents: 100_000, workState: 'PA', residenceState: 'PA' }),
    );
    // annual $26,000 × 3.07% = $798.20 → /26
    expect(r.stateTaxCents).toBe(3_070);
    expect(r.meta.stateType).toBe('flat');
    expect(r.meta.stateWithheldBy).toBe('residence');
  });

  it('CA computes progressive tax with standard deduction', () => {
    const r = calculateWithholding(
      base({ grossPayCents: 400_000, workState: 'CA', residenceState: 'CA' }),
    );
    // annual $104,000 − $5,540 std = $98,460 → $5,699.14 → /26 = $219.1977
    expect(r.stateTaxCents).toBe(21_920);
    expect(r.meta.stateType).toBe('progressive');
  });

  it('CA married joint uses doubled brackets and married std deduction', () => {
    const tax = stateIncomeTax({
      config: STATE_CONFIGS.CA,
      annualTaxableCents: 3_259_200, // pre-std: $21,512 ceiling + $11,080 married std ded
      filingStatus: 'MARRIED_JOINTLY',
    });
    expect(tax).toBe(21_512); // 1% × $21,512
  });

  it('NY withholds state tax and NYC local tax for NYC residents', () => {
    const nyc = calculateWithholding(
      base({ grossPayCents: 250_000, workState: 'NY', residenceState: 'NY', residenceCity: 'New York' }),
    );
    // state: annual $65,000 − $8,000 = $57,000 → $2,970 → /26 = $114.23
    expect(nyc.stateTaxCents).toBe(11_423 + 7_810); // state + NYC combined
    expect(nyc.meta.localTaxCents).toBe(7_810);
    expect(nyc.meta.localTaxLabel).toBe('NYC Resident Income Tax');

    const upstate = calculateWithholding(
      base({ grossPayCents: 250_000, workState: 'NY', residenceState: 'NY', residenceCity: 'Albany' }),
    );
    expect(upstate.meta.localTaxCents).toBe(0);
    expect(upstate.stateTaxCents).toBe(11_423);
  });

  it('applies the NJ ⇄ NY reciprocal pair in both directions', () => {
    expect(isReciprocal('NJ', 'NY')).toBe(true);
    expect(isReciprocal('NY', 'NJ')).toBe(true);
    expect(isReciprocal('CA', 'NY')).toBe(false);

    const njResident = calculateWithholding(
      base({ grossPayCents: 300_000, workState: 'NY', residenceState: 'NJ' }),
    );
    // NJ on annual $78,000: $3,579.85 (crosses the 8.97% band above $75k) → /26
    expect(njResident.stateTaxCents).toBe(13_769);
    expect(njResident.meta.reciprocityApplied).toBe(true);
    expect(njResident.meta.stateWithheldBy).toBe('residence');
    expect(njResident.meta.stateCode).toBe('NJ');

    const nyResident = calculateWithholding(
      base({ grossPayCents: 300_000, workState: 'NJ', residenceState: 'NY' }),
    );
    expect(nyResident.meta.reciprocityApplied).toBe(true);
    expect(nyResident.meta.stateWithheldBy).toBe('residence');
    expect(nyResident.meta.stateCode).toBe('NY');
    expect(nyResident.stateTaxCents).toBe(14_173); // NY on $78k−$8k
  });

  it('handles non-reciprocal cross-state work (source rule + resident fallback)', () => {
    const caLivingInTx = calculateWithholding(
      base({ workState: 'TX', residenceState: 'CA' }),
    );
    // work state has no tax → CA taxes residents on all income
    expect(caLivingInTx.meta.stateWithheldBy).toBe('residence');
    expect(caLivingInInTxStateTax(caLivingInTx.stateTaxCents)).toBe(true);

    const txLivingInCa = calculateWithholding(
      base({ grossPayCents: 400_000, workState: 'CA', residenceState: 'TX' }),
    );
    expect(txLivingInCa.meta.stateWithheldBy).toBe('work');
    expect(txLivingInCa.stateTaxCents).toBe(21_920); // CA source wages
    expect(txLivingInCa.meta.residentCreditEligible).toBe(false); // TX residents owe nothing

    const paLivingInNy = calculateWithholding(
      base({ grossPayCents: 300_000, workState: 'NY', residenceState: 'PA' }),
    );
    expect(paLivingInNy.meta.stateWithheldBy).toBe('work');
    expect(paLivingInNy.meta.residentCreditEligible).toBe(true);
    expect(paLivingInNy.meta.reciprocityApplied).toBe(false);
  });

  it('degrades gracefully for unknown states', () => {
    const r = calculateWithholding(base({ workState: 'ZZ', residenceState: 'ZZ' }));
    expect(r.stateTaxCents).toBe(0);
    expect(r.meta.notes.join(' ')).toMatch(/No tax configuration/);
    const outcome = computeStateTax({
      grossPayCents: 100_000,
      preTaxDeductionsCents: 0,
      periodsPerYear: 26,
      filingStatus: 'SINGLE',
      workState: 'ZZ',
      residenceState: 'CA',
    });
    // Unknown work state → treated as no source tax → CA taxes its resident
    expect(outcome.withheldBy).toBe('residence');
    expect(outcome.stateTaxCents).toBeGreaterThan(0);
  });
});

function caLivingInInTxStateTax(cents: number): boolean {
  return cents > 0;
}

describe('tax engine — invariants & guards', () => {
  const inputs: TaxInput[] = [
    base(),
    base({ grossPayCents: 0 }),
    base({ grossPayCents: 987_654, filingStatus: 'MARRIED_JOINTLY', workState: 'CA', residenceState: 'CA' }),
    base({ grossPayCents: 50_000, workState: 'NY', residenceState: 'NY', residenceCity: 'Brooklyn' }),
    base({ grossPayCents: 1_500_000, filingStatus: 'HEAD_OF_HOUSEHOLD', ytdGrossCents: 16_000_000, workState: 'PA', residenceState: 'PA', preTaxDeductionsCents: 30_000, postTaxDeductionsCents: 7_500, additionalWithholdingCents: 1_000 }),
    base({ frequency: 'WEEKLY' }),
    base({ frequency: 'SEMIMONTHLY' }),
    base({ frequency: 'MONTHLY', filingStatus: 'MARRIED_FILING_SEPARATELY', workState: 'NJ', residenceState: 'NJ' }),
  ];

  it('keeps the accounting identity: gross − taxes − deductions = net', () => {
    for (const input of inputs) {
      const r = calculateWithholding(input);
      const sum =
        r.federalTaxCents +
        r.stateTaxCents +
        r.ficaSsCents +
        r.ficaMedicareCents +
        r.preTaxDeductionsCents +
        r.postTaxDeductionsCents;
      expect(r.grossPayCents - sum).toBe(r.netPayCents);
      for (const value of [
        r.federalTaxCents,
        r.stateTaxCents,
        r.ficaSsCents,
        r.ficaMedicareCents,
        r.netPayCents,
      ]) {
        expect(Number.isInteger(value)).toBe(true);
      }
    }
  });

  it('is a pure function (same input → same output)', () => {
    const a = JSON.stringify(calculateWithholding(base({ residenceCity: 'New York', residenceState: 'NY' })));
    const b = JSON.stringify(calculateWithholding(base({ residenceCity: 'New York', residenceState: 'NY' })));
    expect(a).toBe(b);
  });

  it('returns all zeros for zero gross', () => {
    const r = calculateWithholding(base({ grossPayCents: 0 }));
    expect(r).toMatchObject({
      federalTaxCents: 0,
      stateTaxCents: 0,
      ficaSsCents: 0,
      ficaMedicareCents: 0,
      netPayCents: 0,
    });
  });

  it('rejects malformed inputs', () => {
    expect(() => calculateWithholding(base({ grossPayCents: 100.5 }))).toThrow(/integer/);
    expect(() => calculateWithholding(base({ grossPayCents: -1 }))).toThrow(/negative/);
    expect(() => calculateWithholding(base({ preTaxDeductionsCents: -1 }))).toThrow(/negative/);
    expect(() => calculateWithholding(base({ frequency: 'BIWEEKLY' as any, grossPayCents: 1 }))).not.toThrow();
    expect(() =>
      calculateWithholding(base({ frequency: 'FORTNIGHTLY' as any })),
    ).toThrow(/pay frequency/);
  });

  it('roundCents rounds half-up in both directions', () => {
    expect(roundCents(1.5)).toBe(2);
    expect(roundCents(2.5)).toBe(3);
    expect(roundCents(-1.5)).toBe(-2);
    expect(roundCents(1.4999)).toBe(1);
    expect(() => roundCents(NaN)).toThrow(/Non-finite/);
  });

  it('exposes the same engine through TaxEngineService', () => {
    const service = new TaxEngineService();
    expect(service.calculate(base())).toEqual(calculateWithholding(base()));
    expect(service.hasState('ca')).toBe(true);
    expect(service.hasState('zz')).toBe(false);
    const states = service.supportedStates();
    expect(states.map((s) => s.code).sort()).toEqual(['CA', 'NJ', 'NY', 'PA', 'TX']);
    expect(states.find((s) => s.code === 'NY')?.reciprocalWith).toContain('NJ');
  });
});
