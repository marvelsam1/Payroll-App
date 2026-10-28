import { FilingStatus, roundCents } from './types';

/**
 * 2024 federal income tax — IRS Pub. 15-T percentage method with standard
 * deduction (default W-4 assumptions: no other adjustments, Step 2 unchecked).
 * Amounts in cents. Simulated tax engine — not certified for real compliance.
 */

export const FEDERAL_STANDARD_DEDUCTION_2024: Record<FilingStatus, number> = {
  SINGLE: 1_460_000, // $14,600
  MARRIED_JOINTLY: 2_920_000, // $29,200
  MARRIED_FILING_SEPARATELY: 1_460_000, // $14,600
  HEAD_OF_HOUSEHOLD: 2_190_000, // $21,900
};

type Bracket = { upToCents: number | null; rateBps: number }; // bps = 1/100 %

export const FEDERAL_BRACKETS_2024: Record<FilingStatus, Bracket[]> = {
  SINGLE: [
    { upToCents: 1_160_000, rateBps: 1000 }, //   to $11,600
    { upToCents: 4_715_000, rateBps: 1200 }, //   to $47,150
    { upToCents: 10_052_500, rateBps: 2200 }, //  to $100,525
    { upToCents: 19_195_000, rateBps: 2400 }, //  to $191,950
    { upToCents: 24_372_500, rateBps: 3200 }, //  to $243,725
    { upToCents: 60_935_000, rateBps: 3500 }, //  to $609,350
    { upToCents: null, rateBps: 3700 },
  ],
  MARRIED_JOINTLY: [
    { upToCents: 2_320_000, rateBps: 1000 }, //   to $23,200
    { upToCents: 9_430_000, rateBps: 1200 }, //   to $94,300
    { upToCents: 20_105_000, rateBps: 2200 }, //  to $201,050
    { upToCents: 38_390_000, rateBps: 2400 }, //  to $383,900
    { upToCents: 48_745_000, rateBps: 3200 }, //  to $487,450
    { upToCents: 73_120_000, rateBps: 3500 }, //  to $731,200
    { upToCents: null, rateBps: 3700 },
  ],
  MARRIED_FILING_SEPARATELY: [
    { upToCents: 1_160_000, rateBps: 1000 }, //   to $11,600
    { upToCents: 4_715_000, rateBps: 1200 }, //   to $47,150
    { upToCents: 10_052_500, rateBps: 2200 }, //  to $100,525
    { upToCents: 19_195_000, rateBps: 2400 }, //  to $191,950
    { upToCents: 24_372_500, rateBps: 3200 }, //  to $243,725
    { upToCents: 36_560_000, rateBps: 3500 }, //  to $365,600
    { upToCents: null, rateBps: 3700 },
  ],
  HEAD_OF_HOUSEHOLD: [
    { upToCents: 1_655_000, rateBps: 1000 }, //   to $16,550
    { upToCents: 6_310_000, rateBps: 1200 }, //   to $63,100
    { upToCents: 10_050_000, rateBps: 2200 }, //  to $100,500
    { upToCents: 19_195_000, rateBps: 2400 }, //  to $191,950
    { upToCents: 24_370_000, rateBps: 3200 }, //  to $243,700
    { upToCents: 60_935_000, rateBps: 3500 }, //  to $609,350
    { upToCents: null, rateBps: 3700 },
  ],
};

/** Progressive tax on an annualized amount, in cents. */
export function taxFromBrackets(annualTaxableCents: number, brackets: Bracket[]): number {
  if (annualTaxableCents <= 0) return 0;
  let tax = 0;
  let lower = 0;
  for (const bracket of brackets) {
    const upper = bracket.upToCents ?? Infinity;
    if (annualTaxableCents <= lower) break;
    const slice = Math.min(annualTaxableCents, upper) - lower;
    tax += (slice * bracket.rateBps) / 10_000;
    lower = upper;
    if (annualTaxableCents <= upper) break;
  }
  return roundCents(tax);
}

/** Annual federal withholding for the period, before de-annualization. */
export function federalTaxForPeriod(opts: {
  grossPayCents: number;
  preTaxDeductionsCents: number;
  additionalWithholdingCents: number;
  periodsPerYear: number;
  filingStatus: FilingStatus;
}): number {
  const annualGross = opts.grossPayCents * opts.periodsPerYear;
  const annualPreTax = opts.preTaxDeductionsCents * opts.periodsPerYear;
  const annualTaxable = Math.max(
    0,
    annualGross - annualPreTax - FEDERAL_STANDARD_DEDUCTION_2024[opts.filingStatus],
  );
  const annualTax = taxFromBrackets(annualTaxable, FEDERAL_BRACKETS_2024[opts.filingStatus]);
  const perPeriod = roundCents(annualTax / opts.periodsPerYear);
  return perPeriod + opts.additionalWithholdingCents;
}

/** Exposed for tests / transparency endpoints. */
export function federalAnnualTaxable(opts: {
  grossPayCents: number;
  preTaxDeductionsCents: number;
  periodsPerYear: number;
  filingStatus: FilingStatus;
}): number {
  return Math.max(
    0,
    opts.grossPayCents * opts.periodsPerYear -
      opts.preTaxDeductionsCents * opts.periodsPerYear -
      FEDERAL_STANDARD_DEDUCTION_2024[opts.filingStatus],
  );
}
