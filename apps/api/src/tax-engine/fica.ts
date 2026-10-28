import { FilingStatus, roundCents } from './types';

/**
 * FICA — Federal Insurance Contributions Act (2024 parameters):
 *  - Social Security: 6.2% employee + 6.2% employer, up to the $168,600 wage base.
 *  - Medicare: 1.45% employee + 1.45% employer, no cap.
 *  - Additional Medicare: +0.9% employee on wages over threshold
 *    ($200k single/HOH, $250k MFJ, $125k MFS — payroll withholding thresholds).
 *
 * Simulated tax engine — not certified for real compliance.
 */

export const SS_RATE_BPS = 620; // 6.2%
export const MEDICARE_RATE_BPS = 145; // 1.45%
export const ADDITIONAL_MEDICARE_RATE_BPS = 90; // 0.9%
export const SS_WAGE_BASE_2024 = 16_860_000; // $168,600 in cents

export const ADDITIONAL_MEDICARE_THRESHOLD: Record<FilingStatus, number> = {
  SINGLE: 20_000_000, // $200,000
  HEAD_OF_HOUSEHOLD: 20_000_000,
  MARRIED_FILING_SEPARATELY: 12_500_000, // $125,000
  MARRIED_JOINTLY: 25_000_000, // $250,000
};

export interface FicaInput {
  grossPayCents: number;
  filingStatus: FilingStatus;
  /** YTD gross before this check. */
  ytdGrossCents?: number;
}

export interface FicaResult {
  ficaSsCents: number;
  ficaMedicareCents: number;
  employerFicaSsCents: number;
  employerFicaMedicareCents: number;
  ssTaxableCents: number;
  medicareTaxableCents: number;
  additionalMedicareApplies: boolean;
}

export function computeFica(input: FicaInput): FicaResult {
  const gross = Math.max(0, input.grossPayCents);
  const ytd = Math.max(0, input.ytdGrossCents ?? 0);

  // Social Security — remaining wage-base room this year
  const ssRoom = Math.max(0, SS_WAGE_BASE_2024 - ytd);
  const ssTaxable = Math.min(gross, ssRoom);
  const employeeSs = roundCents((ssTaxable * SS_RATE_BPS) / 10_000);
  const employerSs = employeeSs; // employer matches

  // Medicare — flat rate on all wages; Additional Medicare above threshold
  const medicareTaxable = gross;
  const employeeMedicare = roundCents((medicareTaxable * MEDICARE_RATE_BPS) / 10_000);
  const employerMedicare = employeeMedicare;

  const threshold = ADDITIONAL_MEDICARE_THRESHOLD[input.filingStatus];
  const aboveAfter = Math.max(0, ytd + gross - threshold);
  const aboveBefore = Math.max(0, ytd - threshold);
  const addlPortion = Math.max(0, aboveAfter - aboveBefore); // slice of THIS check
  const additionalMedicare = roundCents((addlPortion * ADDITIONAL_MEDICARE_RATE_BPS) / 10_000);

  return {
    ficaSsCents: employeeSs,
    ficaMedicareCents: employeeMedicare + additionalMedicare,
    employerFicaSsCents: employerSs,
    employerFicaMedicareCents: employerMedicare,
    ssTaxableCents: ssTaxable,
    medicareTaxableCents: medicareTaxable,
    additionalMedicareApplies: additionalMedicare > 0,
  };
}
