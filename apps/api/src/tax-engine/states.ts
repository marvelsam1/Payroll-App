import { FilingStatus, roundCents } from './types';
import { taxFromBrackets } from './federal';

/**
 * State income tax configurations (2024 parameters) for the simulation:
 *   CA — progressive          TX — no individual income tax
 *   PA — flat rate            NY — progressive + NYC local tax
 *   NJ — progressive          (reciprocal pair: NJ ⇄ NY)
 *
 * Simplifications (documented, deliberate):
 *   - Married-jointly thresholds are doubled for CA/NY/NJ (matches those
 *     states' published married schedules); MFS and HOH use single schedules.
 *   - Local tax support covers NYC.
 *
 * Simulated tax engine — not certified for real compliance.
 */

export interface StateBracket {
  upToCents: number | null;
  rateBps: number;
}

export interface StateConfig {
  code: string;
  name: string;
  type: 'none' | 'flat' | 'progressive';
  flatRateBps?: number;
  brackets?: StateBracket[]; // single-filer schedule
  stdDeductionSingleCents?: number;
  stdDeductionMarriedCents?: number;
  /** States with reciprocal withholding agreements with this state. */
  reciprocalWith: string[];
  /** Whether this state taxes its residents on all income (resident-based). */
  taxesResidentsOnAllIncome: boolean;
}

export const STATE_CONFIGS: Record<string, StateConfig> = {
  CA: {
    code: 'CA',
    name: 'California',
    type: 'progressive',
    brackets: [
      { upToCents: 1_075_600, rateBps: 100 }, //  to $10,756
      { upToCents: 2_549_900, rateBps: 200 }, //  to $25,499
      { upToCents: 4_024_500, rateBps: 400 }, //  to $40,245
      { upToCents: 5_586_600, rateBps: 600 }, //  to $55,866
      { upToCents: 7_060_600, rateBps: 800 }, //  to $70,606
      { upToCents: 36_065_900, rateBps: 930 }, //  to $360,659
      { upToCents: 43_278_700, rateBps: 1030 }, // to $432,787
      { upToCents: 72_131_400, rateBps: 1130 }, // to $721,314
      { upToCents: 100_000_000, rateBps: 1230 }, // to $1,000,000
      { upToCents: null, rateBps: 1330 }, // 12.3% + 1% mental health surcharge
    ],
    stdDeductionSingleCents: 554_000, // $5,540
    stdDeductionMarriedCents: 1_108_000, // $11,080
    reciprocalWith: [],
    taxesResidentsOnAllIncome: true,
  },
  TX: {
    code: 'TX',
    name: 'Texas',
    type: 'none',
    reciprocalWith: [],
    taxesResidentsOnAllIncome: false,
  },
  PA: {
    code: 'PA',
    name: 'Pennsylvania',
    type: 'flat',
    flatRateBps: 307, // 3.07%
    stdDeductionSingleCents: 0,
    stdDeductionMarriedCents: 0,
    reciprocalWith: [],
    taxesResidentsOnAllIncome: true,
  },
  NY: {
    code: 'NY',
    name: 'New York',
    type: 'progressive',
    brackets: [
      { upToCents: 850_000, rateBps: 400 }, //  to $8,500
      { upToCents: 1_170_000, rateBps: 450 }, //  to $11,700
      { upToCents: 1_390_000, rateBps: 525 }, //  to $13,900
      { upToCents: 8_065_000, rateBps: 550 }, //  to $80,650
      { upToCents: 21_540_000, rateBps: 600 }, //  to $215,400
      { upToCents: 107_755_000, rateBps: 685 }, // to $1,077,550
      { upToCents: 500_000_000, rateBps: 965 }, // to $5,000,000
      { upToCents: 2_500_000_000, rateBps: 1030 }, // to $25,000,000
      { upToCents: null, rateBps: 1090 },
    ],
    stdDeductionSingleCents: 800_000, // $8,000
    stdDeductionMarriedCents: 1_605_000, // $16,050
    reciprocalWith: ['NJ'],
    taxesResidentsOnAllIncome: true,
  },
  NJ: {
    code: 'NJ',
    name: 'New Jersey',
    type: 'progressive',
    brackets: [
      { upToCents: 2_000_000, rateBps: 140 }, //  to $20,000
      { upToCents: 3_500_000, rateBps: 350 }, //  to $35,000
      { upToCents: 4_000_000, rateBps: 552.5 }, // to $40,000 (5.525%)
      { upToCents: 7_500_000, rateBps: 637 }, //  to $75,000 (6.37%)
      { upToCents: 50_000_000, rateBps: 897 }, //  to $500,000 (8.97%)
      { upToCents: 100_000_000, rateBps: 1075 }, // to $1,000,000 (10.75%)
      { upToCents: null, rateBps: 1175 },
    ],
    stdDeductionSingleCents: 0,
    stdDeductionMarriedCents: 0,
    reciprocalWith: ['NY'],
    taxesResidentsOnAllIncome: true,
  },
};

/** NYC resident local income tax (2024 schedule, single-filer thresholds). */
export const NYC_LOCAL_BRACKETS: StateBracket[] = [
  { upToCents: 1_200_000, rateBps: 287.6 }, //  to $12,000 (2.876%)
  { upToCents: 2_500_000, rateBps: 363.6 }, //  to $25,000 (3.636%)
  { upToCents: 5_000_000, rateBps: 376.6 }, //  to $50,000 (3.766%)
  { upToCents: 10_000_000, rateBps: 387.6 }, //  to $100,000 (3.876%)
  { upToCents: 50_000_000, rateBps: 443.6 }, //  to $500,000 (4.436%)
  { upToCents: null, rateBps: 495 },
];

export const NYC_CITIES = new Set(['new york', 'brooklyn', 'queens', 'bronx', 'staten island']);

export function getStateConfig(code: string): StateConfig | null {
  return STATE_CONFIGS[(code ?? '').toUpperCase()] ?? null;
}

export function isReciprocal(workState: string, residenceState: string): boolean {
  const work = getStateConfig(workState);
  const residence = getStateConfig(residenceState);
  if (!work || !residence) return false;
  if (work.code === residence.code) return false;
  return work.reciprocalWith.includes(residence.code) || residence.reciprocalWith.includes(work.code);
}

export function stateTaxes(config: StateConfig | null): boolean {
  return !!config && config.type !== 'none';
}

function bracketsForFiling(config: StateConfig, filing: FilingStatus): StateBracket[] {
  const base = config.brackets ?? [];
  if (filing === 'MARRIED_JOINTLY') {
    return base.map((b) => ({
      upToCents: b.upToCents === null ? null : b.upToCents * 2,
      rateBps: b.rateBps,
    }));
  }
  return base;
}

function stdDeductionFor(config: StateConfig, filing: FilingStatus): number {
  if (filing === 'MARRIED_JOINTLY') return config.stdDeductionMarriedCents ?? 0;
  return config.stdDeductionSingleCents ?? 0;
}

/** Progressive/flat state tax on annualized taxable wages, in cents. */
export function stateIncomeTax(opts: {
  config: StateConfig;
  annualTaxableCents: number;
  filingStatus: FilingStatus;
}): number {
  const { config } = opts;
  if (config.type === 'none') return 0;
  const afterStd = Math.max(0, opts.annualTaxableCents - stdDeductionFor(config, opts.filingStatus));
  if (config.type === 'flat') {
    return roundCents((afterStd * (config.flatRateBps ?? 0)) / 10_000);
  }
  return taxFromBrackets(afterStd, bracketsForFiling(config, opts.filingStatus));
}

export interface StateTaxOutcome {
  stateTaxCents: number;
  localTaxCents: number;
  localTaxLabel: string | null;
  withheldBy: 'work' | 'residence' | 'none';
  reciprocityApplied: boolean;
  residentCreditEligible: boolean;
  notes: string[];
}

/**
 * Decides which jurisdiction withholds and computes state + local tax.
 *
 * Rules (simulation):
 *  1. Same work & residence state → that state withholds (subject to its tax).
 *  2. Reciprocal pair → residence state withholds; work state withholds 0.
 *  3. Otherwise → work state (source rule) withholds if it has an income tax;
 *     if it doesn't (e.g. TX), the residence state withholds if it taxes
 *     residents on all income.
 *  NYC local tax applies to NYC residents regardless of work location.
 */
export function computeStateTax(opts: {
  grossPayCents: number;
  preTaxDeductionsCents: number;
  periodsPerYear: number;
  filingStatus: FilingStatus;
  workState: string;
  residenceState: string;
  residenceCity?: string | null;
}): StateTaxOutcome {
  const notes: string[] = [];
  const work = getStateConfig(opts.workState);
  const residence = getStateConfig(opts.residenceState);
  const annualGross = opts.grossPayCents * opts.periodsPerYear;
  const annualPreTax = opts.preTaxDeductionsCents * opts.periodsPerYear;
  const annualTaxable = Math.max(0, annualGross - annualPreTax);

  if (!work && !residence) {
    notes.push(`No tax configuration for ${opts.workState}/${opts.residenceState} — treated as no income tax`);
    return {
      stateTaxCents: 0,
      localTaxCents: 0,
      localTaxLabel: null,
      withheldBy: 'none',
      reciprocityApplied: false,
      residentCreditEligible: false,
      notes,
    };
  }

  const sameState = (work?.code ?? opts.workState).toUpperCase() === (residence?.code ?? opts.residenceState).toUpperCase();
  const reciprocal = !sameState && isReciprocal(opts.workState, opts.residenceState);

  let withholdingConfig: StateConfig | null = null;
  let withheldBy: 'work' | 'residence' | 'none' = 'none';
  let residentCreditEligible = false;

  if (sameState) {
    withholdingConfig = residence && stateTaxes(residence) ? residence : null;
    withheldBy = withholdingConfig ? 'residence' : 'none';
    if (!withholdingConfig) notes.push('Work and residence state have no individual income tax');
  } else if (reciprocal) {
    withholdingConfig = stateTaxes(residence) ? residence : null;
    withheldBy = withholdingConfig ? 'residence' : 'none';
    notes.push(
      `Reciprocal agreement applied: wages taxed by residence state ${residence?.code}, not work state ${work?.code}`,
    );
  } else {
    if (work && stateTaxes(work)) {
      withholdingConfig = work;
      withheldBy = 'work';
      if (residence && stateTaxes(residence)) {
        residentCreditEligible = true;
        notes.push(
          `Work state ${work.code} withholds; resident state ${residence.code} credit may apply at filing`,
        );
      }
    } else if (residence && stateTaxes(residence) && residence.taxesResidentsOnAllIncome) {
      withholdingConfig = residence;
      withheldBy = 'residence';
      notes.push(
        `Work state ${opts.workState} has no income tax; resident state ${opts.residenceState} taxes residents on all income`,
      );
    } else {
      notes.push(`No income tax withholding for ${opts.workState} → ${opts.residenceState}`);
    }
  }

  let stateTax = 0;
  if (withholdingConfig) {
    const annualStateTax = stateIncomeTax({
      config: withholdingConfig,
      annualTaxableCents: annualTaxable,
      filingStatus: opts.filingStatus,
    });
    // De-annualize to this pay period (same convention as federal).
    stateTax = roundCents(annualStateTax / opts.periodsPerYear);
  }

  // NYC local tax — resident-based
  let localTax = 0;
  let localTaxLabel: string | null = null;
  const city = (opts.residenceCity ?? '').trim().toLowerCase();
  if ((residence?.code ?? opts.residenceState).toUpperCase() === 'NY' && NYC_CITIES.has(city)) {
    const annualLocalTaxable = Math.max(0, annualTaxable - stdDeductionFor(STATE_CONFIGS.NY, opts.filingStatus));
    const perPeriod = roundCents(
      taxFromBrackets(annualLocalTaxable, NYC_LOCAL_BRACKETS) / opts.periodsPerYear,
    );
    localTax = perPeriod;
    localTaxLabel = 'NYC Resident Income Tax';
    notes.push('NYC resident local income tax applied');
  }

  return {
    stateTaxCents: stateTax,
    localTaxCents: localTax,
    localTaxLabel,
    withheldBy,
    reciprocityApplied: reciprocal,
    residentCreditEligible,
    notes,
  };
}
