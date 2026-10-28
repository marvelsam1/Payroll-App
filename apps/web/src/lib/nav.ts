'use client';

import {
  Activity,
  BadgeDollarSign,
  Banknote,
  Building2,
  CalendarCheck,
  FileText,
  LayoutDashboard,
  Receipt,
  ScrollText,
  Settings,
  Users,
  UsersRound,
} from 'lucide-react';
import type { Role } from './session';

export interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** roles that see this item */
  roles: Role[];
}

const ALL_STAFF: Role[] = ['PLATFORM_ADMIN', 'COMPANY_ADMIN', 'HR_MANAGER', 'ACCOUNTANT', 'EMPLOYEE', 'CONTRACTOR'];
const FINANCE: Role[] = ['PLATFORM_ADMIN', 'COMPANY_ADMIN', 'ACCOUNTANT'];
const ADMIN_ONLY: Role[] = ['PLATFORM_ADMIN', 'COMPANY_ADMIN'];
const HRISH: Role[] = ['PLATFORM_ADMIN', 'COMPANY_ADMIN', 'HR_MANAGER'];
const PAYROLL_PEOPLE: Role[] = ['PLATFORM_ADMIN', 'COMPANY_ADMIN', 'HR_MANAGER', 'ACCOUNTANT'];
const EMPLOYEE_LIKE: Role[] = ['PLATFORM_ADMIN', 'COMPANY_ADMIN', 'HR_MANAGER', 'ACCOUNTANT', 'EMPLOYEE'];
const CONTRACTOR_LIKE: Role[] = ['PLATFORM_ADMIN', 'COMPANY_ADMIN', 'ACCOUNTANT', 'CONTRACTOR'];

export const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ALL_STAFF },
  { href: '/payroll', label: 'Payroll', icon: Banknote, roles: [...PAYROLL_PEOPLE, 'EMPLOYEE'] },
  { href: '/transfers', label: 'Transfers', icon: Activity, roles: FINANCE },
  { href: '/ledger', label: 'Ledger', icon: ScrollText, roles: FINANCE },
  { href: '/employees', label: 'Employees', icon: Users, roles: EMPLOYEE_LIKE },
  { href: '/contractors', label: 'Contractors', icon: UsersRound, roles: CONTRACTOR_LIKE },
  { href: '/departments', label: 'Departments', icon: Building2, roles: HRISH },
  { href: '/invoices', label: 'Invoices', icon: FileText, roles: CONTRACTOR_LIKE },
  { href: '/expenses', label: 'Expenses', icon: Receipt, roles: EMPLOYEE_LIKE },
  { href: '/compliance', label: 'Compliance', icon: CalendarCheck, roles: FINANCE },
  { href: '/audit', label: 'Activity', icon: BadgeDollarSign, roles: ADMIN_ONLY },
  { href: '/settings', label: 'Settings', icon: Settings, roles: ALL_STAFF },
];

export function navFor(role: Role | undefined): NavItem[] {
  if (!role) return [];
  return NAV.filter((item) => item.roles.includes(role));
}

export const ROLE_LABEL: Record<Role, string> = {
  PLATFORM_ADMIN: 'Platform Admin',
  COMPANY_ADMIN: 'Company Admin',
  HR_MANAGER: 'HR Manager',
  ACCOUNTANT: 'Accountant',
  EMPLOYEE: 'Employee',
  CONTRACTOR: 'Contractor',
};
