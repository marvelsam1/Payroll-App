/**
 * Simulated tax engine — not certified for real compliance.
 *
 * Implements the 2024 IRS Pub. 15-T percentage method for federal income tax
 * withholding, FICA (Social Security + Medicare / Additional Medicare), and a
 * set of state configurations (CA, TX, PA, NY + NYC local, NJ) including a
 * reciprocal state pair (NJ/NY).
 *
 * ALL amounts are integer cents. The engine is a pure function: same input →
 * same output, no I/O, no clock, no randomness.
 */

export type FilingStatus =
  | 'SINGLE'
  | 'MARRIED_JOINTLY'
  | 'HEAD_OF_HOUSEHOLD'
  | 'MARRIED_FILING_SEPARATELY';

export type PayFrequency = 'WEEKLY' | 'BIWEEKLY' | 'SEMIMONTHLY' | 'MONTHLY';

export const PERIODS_PER_YEAR: Record<PayFrequency, number> = {
  WEEKLY: 52,
  BIWEEKLY: 26,
  SEMIMONTHLY: 24,
  MONTHLY: 12,
};

export interface TaxInput {
  grossPayCents: number;
  frequency: PayFrequency;
  filingStatus: FilingStatus;
  /** USPS state code where work is performed (e.g. "NY") */
  workState: string;
  /** USPS state code of legal residence */
  residenceState: string;
  /** City of residence — enables local taxes (NYC). */
  residenceCity?: string | null;
  /** Pre-tax deductions: 401(k), health insurance — reduce taxable wages. */
  preTaxDeductionsCents?: number;
  /** Post-tax deductions: Roth, garnishments — taken after taxes. */
  postTaxDeductionsCents?: number;
  /** Employee-requested extra federal withholding (per pay period). */
  additionalWithholdingCents?: number;
  /** Year-to-date gross BEFORE this check — drives FICA wage base caps. */
  ytdGrossCents?: number;
}

export interface TaxResult {
  grossPayCents: number;
  taxableWagesCents: number;
  federalTaxCents: number;
  stateTaxCents: number;
  ficaSsCents: number;
  ficaMedicareCents: number;
  preTaxDeductionsCents: number;
  postTaxDeductionsCents: number;
  additionalWithholdingCents: number;
  netPayCents: number;
  /** Employer-side expense (matches employee FICA under current law). */
  employerFicaSsCents: number;
  employerFicaMedicareCents: number;
  meta: TaxResultMeta;
}

export interface TaxResultMeta {
  annualGrossCents: number;
  federalTaxableAnnualCents: number;
  periodsPerYear: number;
  stateCode: string;
  stateType: 'none' | 'flat' | 'progressive';
  stateWithheldBy: 'work' | 'residence' | 'none';
  localTaxCents: number;
  localTaxLabel: string | null;
  reciprocityApplied: boolean;
  residentCreditEligible: boolean;
  ssTaxableCents: number;
  medicareTaxableCents: number;
  additionalMedicareApplies: boolean;
  notes: string[];
}

/** Half-up rounding to whole cents (deterministic, matches payroll practice). */
export function roundCents(value: number): number {
  if (!Number.isFinite(value)) throw new Error(`Non-finite amount: ${value}`);
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

export function annualize(periodAmountCents: number, periods: number): number {
  return roundCents(periodAmountCents * periods);
}
