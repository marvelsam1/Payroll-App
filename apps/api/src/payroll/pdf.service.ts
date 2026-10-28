import { Injectable } from '@nestjs/common';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';
import { env } from '../config/env';

export interface PayStubData {
  companyName: string;
  employeeName: string;
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  line: {
    grossPay: number;
    federalTax: number;
    stateTax: number;
    ficaSs: number;
    ficaMedicare: number;
    preTaxDeductions: number;
    postTaxDeductions: number;
    expenseReimbursement: number;
    netPay: number;
  };
  ytd: { gross: number; federal: number; ficaSs: number; ficaMedicare: number; net: number };
}

export interface Form941Data {
  companyName: string;
  ein: string;
  periodLabel: string;
  wages: number;
  federalTax: number;
  socialSecurity: number;
  medicare: number;
  employerSocialSecurity: number;
  employerMedicare: number;
}

export interface FormW2Data {
  companyName: string;
  ein: string;
  employeeName: string;
  employeeId: string;
  year: string;
  wages: number;
  federalTax: number;
  socialSecurity: number;
  medicare: number;
  stateTax: number;
  state: string;
  net: number;
}

export interface FormSutaData {
  companyName: string;
  ein: string;
  state: string;
  periodLabel: string;
  taxableWages: number;
  totalWages: number;
  rateBps: number;
  wageBase: number;
  tax: number;
}

const EMERALD = rgb(0.063, 0.725, 0.506);
const DARK = rgb(0.086, 0.11, 0.149);
const MUTED = rgb(0.39, 0.455, 0.545);
const LIGHT = rgb(0.945, 0.961, 0.976);

function money(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${(Math.floor(abs / 100)).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

/** PDF generation with pdf-lib (no headless browser required). */
@Injectable()
export class PdfService {
  private storageDir(): string {
    const dir = path.isAbsolute(env.storageDir)
      ? env.storageDir
      : path.resolve(process.cwd(), env.storageDir);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  payStubPath(runId: string, employeeId: string): string {
    const dir = path.join(this.storageDir(), 'paystubs', runId);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${employeeId}.pdf`);
  }

  async buildPayStub(data: PayStubData): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    doc.setTitle(`Pay stub — ${data.employeeName} — ${data.periodEnd.slice(0, 10)}`);
    const page = doc.addPage([612, 792]);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const font = await doc.embedFont(StandardFonts.Helvetica);

    // Header band
    page.drawRectangle({ x: 0, y: 700, width: 612, height: 92, color: EMERALD });
    page.drawText(data.companyName, { x: 40, y: 752, size: 20, font: bold, color: rgb(1, 1, 1) });
    page.drawText('PAY STUB — SIMULATED', { x: 40, y: 728, size: 10, font: bold, color: rgb(0.93, 1, 0.97) });
    page.drawText(`Pay date: ${data.payDate.slice(0, 10)}`, { x: 420, y: 752, size: 10, font, color: rgb(1, 1, 1) });
    page.drawText(`Period: ${data.periodStart.slice(0, 10)} - ${data.periodEnd.slice(0, 10)}`, {
      x: 380, y: 734, size: 9, font, color: rgb(0.93, 1, 0.97),
    });

    let y = 660;
    page.drawText('Employee', { x: 40, y, size: 9, font, color: MUTED });
    page.drawText(data.employeeName, { x: 40, y: y - 14, size: 13, font: bold, color: DARK });
    page.drawText('Employee ID', { x: 300, y, size: 9, font, color: MUTED });
    page.drawText(data.employeeId.slice(0, 18), { x: 300, y: y - 14, size: 11, font, color: DARK });
    y -= 50;

    const row = (label: string, value: number, opts?: { bold?: boolean; negative?: boolean }) => {
      page.drawText(label, { x: 40, y, size: 10, font: opts?.bold ? bold : font, color: DARK });
      page.drawText(money(value), {
        x: 470, y, size: 10, font: opts?.bold ? bold : font,
        color: value < 0 ? rgb(0.85, 0.2, 0.3) : DARK,
      });
      y -= 18;
    };

    page.drawRectangle({ x: 32, y: y + 6, width: 548, height: 20, color: LIGHT });
    page.drawText('EARNINGS & DEDUCTIONS', { x: 40, y: y + 11, size: 9, font: bold, color: MUTED });
    y -= 16;
    row('Gross pay', data.line.grossPay, { bold: true });
    row('Pre-tax deductions (401k / health)', -data.line.preTaxDeductions);
    row('Federal income tax', -data.line.federalTax);
    row('State / local income tax', -data.line.stateTax);
    row('Social Security (6.2%)', -data.line.ficaSs);
    row('Medicare (1.45%)', -data.line.ficaMedicare);
    row('Post-tax deductions', -data.line.postTaxDeductions);
    if (data.line.expenseReimbursement > 0) {
      row('Expense reimbursement', data.line.expenseReimbursement);
    }
    y -= 4;
    page.drawRectangle({ x: 32, y: y + 4, width: 548, height: 24, color: rgb(0.925, 0.996, 0.96) });
    page.drawText('NET PAY', { x: 40, y: y + 12, size: 11, font: bold, color: rgb(0.02, 0.37, 0.27) });
    page.drawText(money(data.line.netPay), {
      x: 462, y: y + 12, size: 13, font: bold, color: rgb(0.02, 0.37, 0.27),
    });
    y -= 44;

    page.drawRectangle({ x: 32, y: y + 4, width: 548, height: 20, color: LIGHT });
    page.drawText('YEAR TO DATE', { x: 40, y: y + 9, size: 9, font: bold, color: MUTED });
    y -= 16;
    row('YTD gross', data.ytd.gross);
    row('YTD federal tax', data.ytd.federal);
    row('YTD Social Security', data.ytd.ficaSs);
    row('YTD Medicare', data.ytd.ficaMedicare);
    row('YTD net', data.ytd.net, { bold: true });

    page.drawText(
      'Simulated fintech platform for portfolio demonstration. No real money is moved and no real tax filings occur.',
      { x: 40, y: 40, size: 7.5, font, color: MUTED },
    );
    page.drawText('SIMULATED — NOT FOR FILING', {
      x: 150, y: 300, size: 34, font: bold, color: rgb(0.9, 0.93, 0.96), rotate: degrees(-35),
      opacity: 0.5,
    });

    return doc.save();
  }

  private async watermark941(doc: PDFDocument, pageWidth: number, pageHeight: number) {
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.getPages()[0];
    page.drawText('SIMULATED — NOT FOR FILING', {
      x: pageWidth / 2 - 150,
      y: pageHeight / 2,
      size: 36,
      font: bold,
      color: rgb(0.85, 0.88, 0.92),
      rotate: degrees(-32),
      opacity: 0.55,
    });
  }

  async buildForm941(data: Form941Data): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const DARKC = rgb(0.086, 0.11, 0.149);

    page.drawText('Form 941 (SIMULATED MOCKUP)', { x: 40, y: 740, size: 18, font: bold, color: DARKC });
    page.drawText('Employer’s Quarterly Federal Tax Return', { x: 40, y: 720, size: 11, font, color: DARKC });
    page.drawText(`Employer: ${data.companyName}`, { x: 40, y: 690, size: 11, font, color: DARKC });
    page.drawText(`EIN: ${data.ein}`, { x: 40, y: 674, size: 11, font, color: DARKC });
    page.drawText(`Period: ${data.periodLabel}`, { x: 40, y: 658, size: 11, font, color: DARKC });
    page.drawRectangle({ x: 36, y: 636, width: 540, height: 2, color: EMERALD });

    let y = 600;
    const line = (label: string, value: string) => {
      page.drawText(label, { x: 60, y, size: 11, font, color: DARKC });
      page.drawText(value, { x: 440, y, size: 11, font: bold, color: DARKC });
      y -= 26;
    };
    line('1  Total wages, tips, and other compensation', money(data.wages));
    line('2  Federal income tax withheld from wages', money(data.federalTax));
    line('3  Social Security wages × 6.2% (employee)', money(data.socialSecurity));
    line('4  Medicare wages × 1.45% (employee)', money(data.medicare));
    line('5a Social Security tax (employee + employer)', money(data.socialSecurity * 2));
    line('5b Medicare tax (employee + employer)', money(data.medicare * 2));
    const total = data.federalTax + data.socialSecurity * 2 + data.medicare * 2;
    y -= 6;
    page.drawRectangle({ x: 48, y: y + 4, width: 516, height: 26, color: rgb(0.925, 0.996, 0.96) });
    line('Total liability for the quarter', money(total));
    y -= 30;
    page.drawText('Populated from the PayLedger double-entry ledger (real computed data).', {
      x: 60, y, size: 9, font, color: MUTED,
    });
    page.drawText('Simulated fintech platform for portfolio demonstration. No real money is moved and no real tax filings occur.', {
      x: 40, y: 44, size: 7.5, font, color: MUTED,
    });
    await this.watermark941(doc, 612, 792);
    return doc.save();
  }

  async buildFormW2(data: FormW2Data): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([756, 432]); // W-2 landscape-ish
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const DARKC = rgb(0.086, 0.11, 0.149);

    page.drawText('Form W-2 (SIMULATED MOCKUP)', { x: 30, y: 396, size: 16, font: bold, color: DARKC });
    page.drawText(`Year ${data.year}`, { x: 300, y: 396, size: 12, font, color: DARKC });
    page.drawText(`Employer: ${data.companyName}   EIN ${data.ein}`, { x: 30, y: 372, size: 10, font, color: DARKC });
    page.drawText(`Employee: ${data.employeeName}   ID ${data.employeeId.slice(0, 14)}`, { x: 30, y: 356, size: 10, font, color: DARKC });

    const box = (x: number, yb: number, w: number, h: number, label: string, value: string) => {
      page.drawRectangle({ x, y: yb, width: w, height: h, borderColor: DARKC, borderWidth: 0.75 });
      page.drawText(label, { x: x + 6, y: yb + h - 16, size: 8, font, color: MUTED });
      page.drawText(value, { x: x + 6, y: yb + 10, size: 12, font: bold, color: DARKC });
    };

    box(30, 260, 220, 70, '1 — WAGES, TIPS, OTHER COMPENSATION', money(data.wages));
    box(260, 260, 220, 70, '2 — FEDERAL INCOME TAX WITHHELD', money(data.federalTax));
    box(490, 260, 220, 70, '3 — SOCIAL SECURITY WAGES', money(data.wages));
    box(30, 175, 220, 70, '4 — SOCIAL SECURITY TAX WITHHELD', money(data.socialSecurity));
    box(260, 175, 220, 70, '5 — MEDICARE WAGES AND TIPS', money(data.wages));
    box(490, 175, 220, 70, '6 — MEDICARE TAX WITHHELD', money(data.medicare));
    box(30, 90, 220, 70, `16 — STATE: ${data.state}`, money(data.stateTax));
    box(260, 90, 220, 70, 'NET PAID (memo)', money(data.net));
    box(490, 90, 220, 70, '20 — SIMULATED', 'NOT FOR FILING');

    page.drawText('Simulated fintech platform for portfolio demonstration. No real money is moved and no real tax filings occur.', {
      x: 30, y: 40, size: 7.5, font, color: MUTED,
    });
    await this.watermark941(doc, 756, 432);
    return doc.save();
  }

  async buildSuta(data: FormSutaData): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const DARKC = rgb(0.086, 0.11, 0.149);

    page.drawText(`SUTA ${data.state} (SIMULATED MOCKUP)`, { x: 40, y: 740, size: 18, font: bold, color: DARKC });
    page.drawText('State Unemployment Tax Report — quarterly wage detail', { x: 40, y: 720, size: 11, font, color: DARKC });
    page.drawText(`Employer: ${data.companyName}   EIN ${data.ein}`, { x: 40, y: 690, size: 11, font, color: DARKC });
    page.drawText(`Period: ${data.periodLabel}`, { x: 40, y: 674, size: 11, font, color: DARKC });
    page.drawRectangle({ x: 36, y: 652, width: 540, height: 2, color: EMERALD });

    let y = 616;
    const line = (label: string, value: string) => {
      page.drawText(label, { x: 60, y, size: 11, font, color: DARKC });
      page.drawText(value, { x: 440, y, size: 11, font: bold, color: DARKC });
      y -= 26;
    };
    line('Total wages paid in state', money(data.totalWages));
    line(`Taxable wages (first ${money(data.wageBase)} per employee)`, money(data.taxableWages));
    line(`Experience rate (${(data.rateBps / 100).toFixed(2)}%)`, money(data.tax));
    page.drawText('Computed from ledger + payroll line items. Simulated — not for filing.', {
      x: 60, y: y - 10, size: 9, font, color: MUTED,
    });
    page.drawText('Simulated fintech platform for portfolio demonstration. No real money is moved and no real tax filings occur.', {
      x: 40, y: 44, size: 7.5, font, color: MUTED,
    });
    await this.watermark941(doc, 612, 792);
    return doc.save();
  }

  /** Write a generated stub to disk if missing; returns the path. */
  async ensurePayStub(
    runId: string,
    employeeId: string,
    build: () => Promise<Uint8Array>,
  ): Promise<string> {
    const file = this.payStubPath(runId, employeeId);
    if (!fs.existsSync(file)) {
      const bytes = await build();
      fs.writeFileSync(file, bytes);
    }
    return file;
  }
}
