import { federalAnnualTaxable, federalTaxForPeriod } from './federal';
import { computeFica } from './fica';
import { computeStateTax, getStateConfig } from './states';
import { PERIODS_PER_YEAR, roundCents, TaxInput, TaxResult } from './types';

/**
 * Simulated tax engine — not certified for real compliance.
 *
 * PURE FUNCTION — no I/O, no clock, no randomness, no database.
 *
 *   (grossPay, frequency, filingStatus, state, deductions) → TaxResult
 *
 * Ordering mirrors a real payroll check:
 *   gross
 *     − pre-tax deductions      (401k, health — reduce taxable wages)
 *     − federal income tax      (2024 Pub. 15-T percentage method, annualized)
 *     − state / local income tax (by jurisdiction rules incl. reciprocity)
 *     − FICA Social Security    (6.2% up to wage base, YTD-aware)
 *     − FICA Medicare           (1.45% + 0.9% additional over threshold)
 *     − post-tax deductions     (Roth, garnishments)
 *     − additional withholding
 *   = net pay
 *
 * All arithmetic is in integer cents with half-up rounding per component.
 */
export function calculateWithholding(input: TaxInput): TaxResult {
  validate(input);

  const periods = PERIODS_PER_YEAR[input.frequency];
  const gross = Math.max(0, roundCents(input.grossPayCents));
  const preTax = Math.max(0, roundCents(input.preTaxDeductionsCents ?? 0));
  const postTax = Math.max(0, roundCents(input.postTaxDeductionsCents ?? 0));
  const additional = Math.max(0, roundCents(input.additionalWithholdingCents ?? 0));
  const ytdGross = Math.max(0, roundCents(input.ytdGrossCents ?? 0));

  const taxableWages = Math.max(0, gross - preTax);

  const federalTax = federalTaxForPeriod({
    grossPayCents: gross,
    preTaxDeductionsCents: preTax,
    additionalWithholdingCents: additional,
    periodsPerYear: periods,
    filingStatus: input.filingStatus,
  });

  const state = computeStateTax({
    grossPayCents: gross,
    preTaxDeductionsCents: preTax,
    periodsPerYear: periods,
    filingStatus: input.filingStatus,
    workState: input.workState,
    residenceState: input.residenceState,
    residenceCity: input.residenceCity ?? null,
  });

  const fica = computeFica({
    grossPayCents: gross,
    filingStatus: input.filingStatus,
    ytdGrossCents: ytdGross,
  });

  const totalWithheld =
    federalTax +
    state.stateTaxCents +
    state.localTaxCents +
    fica.ficaSsCents +
    fica.ficaMedicareCents +
    preTax +
    postTax;

  const netPay = gross - totalWithheld;

  return {
    grossPayCents: gross,
    taxableWagesCents: taxableWages,
    federalTaxCents: federalTax,
    stateTaxCents: state.stateTaxCents + state.localTaxCents,
    ficaSsCents: fica.ficaSsCents,
    ficaMedicareCents: fica.ficaMedicareCents,
    preTaxDeductionsCents: preTax,
    postTaxDeductionsCents: postTax,
    additionalWithholdingCents: additional,
    netPayCents: netPay,
    employerFicaSsCents: fica.employerFicaSsCents,
    employerFicaMedicareCents: fica.employerFicaMedicareCents,
    meta: {
      annualGrossCents: roundCents(gross * periods),
      federalTaxableAnnualCents: federalAnnualTaxable({
        grossPayCents: gross,
        preTaxDeductionsCents: preTax,
        periodsPerYear: periods,
        filingStatus: input.filingStatus,
      }),
      periodsPerYear: periods,
      stateCode:
        state.withheldBy === 'none'
          ? 'NONE'
          : (state.withheldBy === 'work' ? input.workState : input.residenceState).toUpperCase(),
      stateType:
        state.withheldBy === 'none'
          ? 'none'
          : (getStateConfig(
              state.withheldBy === 'work' ? input.workState : input.residenceState,
            )?.type ?? 'none'),
      stateWithheldBy: state.withheldBy,
      localTaxCents: state.localTaxCents,
      localTaxLabel: state.localTaxLabel,
      reciprocityApplied: state.reciprocityApplied,
      residentCreditEligible: state.residentCreditEligible,
      ssTaxableCents: fica.ssTaxableCents,
      medicareTaxableCents: fica.medicareTaxableCents,
      additionalMedicareApplies: fica.additionalMedicareApplies,
      notes: state.notes,
    },
  };
}

function validate(input: TaxInput): void {
  if (!Number.isInteger(input.grossPayCents)) {
    throw new Error('grossPayCents must be an integer (cents)');
  }
  if (input.grossPayCents < 0) {
    throw new Error('grossPayCents cannot be negative');
  }
  if (!PERIODS_PER_YEAR[input.frequency]) {
    throw new Error(`Unknown pay frequency: ${input.frequency}`);
  }
  for (const key of [
    'preTaxDeductionsCents',
    'postTaxDeductionsCents',
    'additionalWithholdingCents',
    'ytdGrossCents',
  ] as const) {
    const value = input[key];
    if (value !== undefined && value !== null && !Number.isInteger(value)) {
      throw new Error(`${key} must be an integer (cents)`);
    }
    if (typeof value === 'number' && value < 0) {
      throw new Error(`${key} cannot be negative`);
    }
  }
}
