import { AccountType, NormalSide } from '../generated/client';

/**
 * Standard chart of accounts provisioned for every company.
 * Core accounts required by the platform spec plus supporting accounts
 * (transit, opening equity, wages/expense accounts) needed for a complete
 * double-entry model of payroll & contractor money movement.
 */
export interface AccountDefinition {
  code: string;
  accountName: string;
  accountType: AccountType;
  normalSide: NormalSide;
}

export const ACCOUNT_CATALOG: AccountDefinition[] = [
  // Assets
  { code: 'OPERATING_CASH', accountName: 'Company Operating Cash', accountType: 'ASSET', normalSide: 'DEBIT' },
  { code: 'ACH_TRANSIT', accountName: 'ACH Cash in Transit', accountType: 'ASSET', normalSide: 'DEBIT' },
  // Equity
  { code: 'OPENING_BALANCE_EQUITY', accountName: 'Opening Balance Equity', accountType: 'EQUITY', normalSide: 'CREDIT' },
  // Revenue (client receipts — funds payroll outflows in the simulation)
  { code: 'REVENUE', accountName: 'Client Revenue', accountType: 'REVENUE', normalSide: 'CREDIT' },
  // Expenses
  { code: 'WAGES_EXPENSE', accountName: 'Gross Wages Expense', accountType: 'EXPENSE', normalSide: 'DEBIT' },
  { code: 'EMPLOYER_TAX_EXPENSE', accountName: 'Employer Payroll Tax Expense', accountType: 'EXPENSE', normalSide: 'DEBIT' },
  { code: 'CONTRACTOR_EXPENSE', accountName: 'Contractor Expense', accountType: 'EXPENSE', normalSide: 'DEBIT' },
  { code: 'REIMBURSABLE_EXPENSE', accountName: 'Employee Reimbursable Expenses', accountType: 'EXPENSE', normalSide: 'DEBIT' },
  // Liabilities
  { code: 'NET_PAY_PAYABLE', accountName: 'Employee Net Pay Payable', accountType: 'LIABILITY', normalSide: 'CREDIT' },
  { code: 'TAX_WITHHOLDING_PAYABLE', accountName: 'Tax Withholding Payable', accountType: 'LIABILITY', normalSide: 'CREDIT' },
  { code: 'DEDUCTIONS_PAYABLE', accountName: 'Employee Deductions Payable', accountType: 'LIABILITY', normalSide: 'CREDIT' },
  { code: 'EXPENSE_REIMBURSEMENT_PAYABLE', accountName: 'Expense Reimbursement Payable', accountType: 'LIABILITY', normalSide: 'CREDIT' },
  { code: 'CONTRACTOR_PAYABLE', accountName: 'Contractor Payable', accountType: 'LIABILITY', normalSide: 'CREDIT' },
];

export const ACCOUNT_CODES = ACCOUNT_CATALOG.map((a) => a.code);
