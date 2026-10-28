import { Role } from '../generated/client';

/**
 * API-level RBAC matrix. Permissions are enforced by RbacGuard on every
 * route — hidden UI is convenience only, never the security boundary.
 */
export const PERMISSIONS = {
  companyRead: 'company:read',
  companyWrite: 'company:write',
  platformManage: 'platform:manage',

  employeesRead: 'employees:read',
  employeesWrite: 'employees:write',
  contractorsRead: 'contractors:read',
  contractorsWrite: 'contractors:write',
  departmentsRead: 'departments:read',
  departmentsWrite: 'departments:write',

  payrollRead: 'payroll:read',
  payrollCreate: 'payroll:create',
  payrollApprove: 'payroll:approve',
  payrollProcess: 'payroll:process',

  ledgerRead: 'ledger:read',
  ledgerReverse: 'ledger:reverse',

  transfersRead: 'transfers:read',
  transfersManage: 'transfers:manage',

  invoicesRead: 'invoices:read',
  invoicesSubmit: 'invoices:submit',
  invoicesApprove: 'invoices:approve',
  invoicesPay: 'invoices:pay',

  expensesRead: 'expenses:read',
  expensesSubmit: 'expenses:submit',
  expensesApprove: 'expenses:approve',
  expensesReimburse: 'expenses:reimburse',

  complianceRead: 'compliance:read',
  complianceGenerate: 'compliance:generate',
  auditRead: 'audit:read',
  dashboardRead: 'dashboard:read',
  settingsRead: 'settings:read',
  settingsWrite: 'settings:write',
  paystubsRead: 'paystubs:read',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const ALL: Permission[] = Object.values(PERMISSIONS);

const companyAdmin: Permission[] = [
  ...ALL.filter((p) => p !== PERMISSIONS.platformManage),
];

const hrManager: Permission[] = [
  PERMISSIONS.companyRead,
  PERMISSIONS.employeesRead,
  PERMISSIONS.employeesWrite,
  PERMISSIONS.departmentsRead,
  PERMISSIONS.payrollRead,
  PERMISSIONS.expensesRead,
  PERMISSIONS.expensesApprove,
  PERMISSIONS.dashboardRead,
  PERMISSIONS.settingsRead,
];

const accountant: Permission[] = [
  PERMISSIONS.companyRead,
  PERMISSIONS.employeesRead,
  PERMISSIONS.contractorsRead,
  PERMISSIONS.departmentsRead,
  PERMISSIONS.payrollRead,
  PERMISSIONS.ledgerRead,
  PERMISSIONS.transfersRead,
  PERMISSIONS.invoicesRead,
  PERMISSIONS.expensesRead,
  PERMISSIONS.complianceRead,
  PERMISSIONS.dashboardRead,
  PERMISSIONS.settingsRead,
];

const employee: Permission[] = [
  PERMISSIONS.dashboardRead,
  PERMISSIONS.expensesRead,
  PERMISSIONS.expensesSubmit,
  PERMISSIONS.paystubsRead,
  PERMISSIONS.settingsRead,
];

const contractor: Permission[] = [
  PERMISSIONS.dashboardRead,
  PERMISSIONS.invoicesRead,
  PERMISSIONS.invoicesSubmit,
  PERMISSIONS.settingsRead,
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.PLATFORM_ADMIN]: ALL,
  [Role.COMPANY_ADMIN]: companyAdmin,
  [Role.HR_MANAGER]: hrManager,
  [Role.ACCOUNTANT]: accountant,
  [Role.EMPLOYEE]: employee,
  [Role.CONTRACTOR]: contractor,
};

export function hasPermission(role: Role, permission: Permission): boolean {
  if (role === Role.PLATFORM_ADMIN) return true;
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}

/** Roles that act inside a single tenant. Platform admins are global. */
export function isTenantRole(role: Role): boolean {
  return role !== Role.PLATFORM_ADMIN;
}
