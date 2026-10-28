'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowUpRight,
  Banknote,
  CalendarClock,
  CircleDollarSign,
  Users,
  Wallet,
} from 'lucide-react';
import { useApi } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn, date, dateTime, money, moneyShort, pct } from '@/lib/format';
import { Card, CardHeader, EmptyState, Skeleton, StatCard, Badge, statusTone } from '@/components/ui';
import { CashflowChart, BarsByDept, EarningsLine, ShareDonut } from '@/components/charts';
import { Stagger, StaggerItem, FadeIn, easeOut } from '@/components/motion';
import { ROLE_LABEL } from '@/lib/nav';

interface DashboardData {
  role: string;
  variant: 'finance' | 'hr' | 'employee' | 'contractor';
  company?: { id: string; name: string; paySchedule: string; monthlyRevenueCents: number; chaosMode: boolean };
  kpis: Record<string, any>;
  cashflow?: Array<{ date: string; netCents: number; balanceCents: number; projected?: boolean }>;
  payrollByDepartment?: Array<{ name: string; grossCents: number }>;
  departments?: Array<{ id: string; name: string; budgetCents: number; spentCents?: number; headcount?: number }>;
  recentActivity?: Array<{ id: string; action: string; entityType: string; actorEmail?: string; createdAt: string }>;
  workforceByState?: Array<{ state: string; count: number }>;
  profile?: Record<string, any>;
  series?: Array<{ periodEnd: string; gross: number; net: number; taxes: number }>;
  reimbursements?: Array<{ id: string; amountCents: number; status: string; category: string }>;
  recentStubs?: Array<{ runId: string; periodStart: string; periodEnd: string; netPay: number }>;
  invoices?: Array<{ id: string; description: string; amountCents: number; status: string; transferStatus?: string | null; failureCode?: string | null }>;
  payments?: Array<{ id: string; amountCents: number; status: string; failureCode?: string | null; createdAt: string }>;
}

function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={easeOut}
      className="mb-6 flex items-end justify-between gap-4"
    >
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
    </motion.div>
  );
}

export default function DashboardPage() {
  const { user } = useSession();
  const { data, loading, error } = useApi<DashboardData>('/dashboard');
  const reduced = useReducedMotion();

  const title = useMemo(() => {
    if (!data) return 'Dashboard';
    if (data.variant === 'employee') return `Hey, ${data.profile?.name?.split(' ')[0] ?? 'there'}`;
    if (data.variant === 'contractor') return `Hey, ${data.profile?.name?.split(' ')[0] ?? 'there'}`;
    return data.company?.name ?? 'Dashboard';
  }, [data]);

  if (loading && !data) {
    return (
      <div>
        <Skeleton className="mb-6 h-8 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-80 lg:col-span-2" />
          <Skeleton className="h-80" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return <EmptyState title="Dashboard unavailable" hint={error ?? 'No data returned.'} />;
  }

  // -----------------------------------------------------------------------
  // Finance variant (Company Admin / Accountant / Platform Admin)
  // -----------------------------------------------------------------------
  if (data.variant === 'finance') {
    const k = data.kpis;
    return (
      <div>
        <PageTitle
          title={title}
          subtitle={`Payroll control center · ${ROLE_LABEL[user?.role ?? 'COMPANY_ADMIN']} · pays ${String(data.company?.paySchedule).toLowerCase().replace('_', ' ')}`}
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Operating cash"
            value={k.cashBalanceCents}
            tone="brand"
            hint={
              <>
                {data.company?.chaosMode ? 'ACH chaos mode ON' : 'ACH rails nominal'} ·{' '}
                <Link href="/ledger" className="text-brand-600 hover:underline">
                  ledger
                </Link>
              </>
            }
          />
          <StatCard label="YTD payroll cost" value={k.ytdPayrollCostCents} tone="sky" delay={0.05} hint="Gross wages, current year" />
          <StatCard
            label="Labor cost %"
            value={Math.round((k.laborCostPct ?? 0) * 10)}
            format="percent"
            tone="amber"
            delay={0.1}
            hint={`${money(k.monthlyLaborCostCents)} last 30 days vs ${moneyShort(data.company?.monthlyRevenueCents ?? 0)}/mo revenue`}
          />
          <StatCard label="Headcount" value={k.headcount} tone="slate" delay={0.15} hint="Active employees" />
        </div>

        {/* Approvals strip */}
        <FadeIn delay={0.05}>
          <Card className="mt-5 p-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
              <span className="font-medium text-slate-700">Needs attention</span>
              {[
                { label: 'payroll runs', n: k.pendingApprovals?.payroll, href: '/payroll' },
                { label: 'expenses', n: k.pendingApprovals?.expenses, href: '/expenses' },
                { label: 'invoices', n: k.pendingApprovals?.invoices, href: '/invoices' },
              ].map((x) => (
                <Link
                  key={x.label}
                  href={x.href}
                  className={cn(
                    'group inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                    x.n > 0 ? 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 hover:bg-amber-100' : 'text-slate-400',
                  )}
                >
                  {x.n > 0 ? `${x.n} ${x.label}` : `no ${x.label} pending`}
                  {x.n > 0 && <ArrowUpRight className="h-3 w-3 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />}
                </Link>
              ))}
              <span className="ml-auto inline-flex items-center gap-2 text-xs text-slate-500">
                <CalendarClock className="h-3.5 w-3.5 text-brand-500" />
                {k.nextPayroll ? (
                  <>
                    Next payroll <strong className="financial text-slate-800">{money(k.nextPayroll.estimatedNetCents)}</strong>{' '}
                    net · {date(k.nextPayroll.periodEnd)} · in {k.nextPayroll.daysUntil}d
                  </>
                ) : (
                  'No payroll scheduled yet'
                )}
              </span>
            </div>
          </Card>
        </FadeIn>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <FadeIn delay={0.08} className="lg:col-span-2">
            <Card className="h-full">
              <CardHeader
                title="Cash flow"
                subtitle="Daily operating balance from the double-entry ledger (90 days)"
                action={
                  <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-medium text-brand-700 ring-1 ring-inset ring-brand-100">
                    live · projected point included
                  </span>
                }
              />
              <div className="px-3 py-4">
                <CashflowChart data={data.cashflow ?? []} />
              </div>
            </Card>
          </FadeIn>

          <FadeIn delay={0.14}>
            <Card className="h-full">
              <CardHeader title="Latest activity" subtitle="Immutable audit trail" />
              <div className="max-h-[300px] overflow-y-auto">
                <Stagger className="divide-y divide-slate-50">
                  {(data.recentActivity ?? []).map((a) => (
                    <StaggerItem key={a.id}>
                      <div className="px-5 py-3">
                        <p className="text-xs font-medium text-slate-700">{a.action}</p>
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          {a.entityType} · {a.actorEmail ?? 'system'} · {dateTime(a.createdAt)}
                        </p>
                      </div>
                    </StaggerItem>
                  ))}
                  {(data.recentActivity ?? []).length === 0 && (
                    <p className="px-5 py-8 text-center text-xs text-slate-400">No activity yet</p>
                  )}
                </Stagger>
              </div>
              <Link
                href="/audit"
                className="block border-t border-slate-100 px-5 py-2.5 text-center text-xs font-medium text-brand-600 hover:bg-brand-50/50"
              >
                Open activity viewer →
              </Link>
            </Card>
          </FadeIn>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <FadeIn delay={0.05} className="lg:col-span-2">
            <Card>
              <CardHeader title="Payroll by department" subtitle="Latest completed run" />
              <div className="px-3 py-4">
                <BarsByDept data={(data.payrollByDepartment ?? []).map((d) => ({ name: d.name, cents: d.grossCents }))} height={240} />
              </div>
            </Card>
          </FadeIn>

          <FadeIn delay={0.1}>
            <Card>
              <CardHeader title="Department budgets" subtitle="YTD approved spend vs budget" />
              <Stagger className="space-y-3.5 p-5">
                {(data.departments ?? []).map((d) => {
                  const ratio = d.budgetCents > 0 ? Math.min(1.4, (d.spentCents ?? 0) / d.budgetCents) : 0;
                  const over = ratio > 0.9;
                  return (
                    <StaggerItem key={d.id}>
                      <div>
                        <div className="flex items-baseline justify-between text-xs">
                          <span className="font-medium text-slate-700">{d.name}</span>
                          <span className="financial text-slate-500">
                            {moneyShort(d.spentCents ?? 0)} <span className="text-slate-300">/</span> {moneyShort(d.budgetCents)}
                          </span>
                        </div>
                        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                          <motion.div
                            className={cn('h-full rounded-full', over ? 'bg-amber-400' : 'bg-brand-500')}
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(100, ratio * 100)}%` }}
                            transition={{ ...easeOut, duration: 0.9 }}
                          />
                        </div>
                      </div>
                    </StaggerItem>
                  );
                })}
              </Stagger>
            </Card>
          </FadeIn>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // HR variant — no ledger-derived widgets (permission matrix)
  // -----------------------------------------------------------------------
  if (data.variant === 'hr') {
    const k = data.kpis;
    return (
      <div>
        <PageTitle title={title} subtitle={`Workforce operations · ${ROLE_LABEL[user?.role ?? 'HR_MANAGER']}`} />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard label="Headcount" value={k.headcount} tone="brand" hint="Active employees" />
          <StatCard label="Pending expenses" value={k.pendingExpenses} tone="amber" delay={0.05} format="number" hint="Awaiting approval" />
          <StatCard label="Departments" value={(data.departments ?? []).length} tone="slate" delay={0.1} format="number" hint="Across the org" />
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <FadeIn>
            <Card>
              <CardHeader title="Departments" subtitle="Headcount and budgets" />
              <Stagger className="divide-y divide-slate-50">
                {(data.departments ?? []).map((d) => (
                  <StaggerItem key={d.id}>
                    <div className="flex items-center justify-between px-5 py-3">
                      <span className="text-sm font-medium text-slate-700">{d.name}</span>
                      <span className="text-xs text-slate-500">
                        <strong className="financial text-slate-800">{d.headcount}</strong> people ·{' '}
                        <span className="financial">{moneyShort(d.budgetCents)}</span> budget
                      </span>
                    </div>
                  </StaggerItem>
                ))}
              </Stagger>
            </Card>
          </FadeIn>
          <FadeIn delay={0.08}>
            <Card>
              <CardHeader title="Workforce by state" subtitle="Withholding jurisdictions in play" />
              <div className="flex flex-wrap gap-2 p-5">
                {(data.workforceByState ?? []).map((s) => (
                  <motion.span
                    key={s.state}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={easeOut}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200"
                  >
                    {s.state}
                    <span className="financial text-slate-400">{s.count}</span>
                  </motion.span>
                ))}
              </div>
            </Card>
          </FadeIn>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Employee variant
  // -----------------------------------------------------------------------
  if (data.variant === 'employee') {
    const k = data.kpis;
    return (
      <div>
        <PageTitle title={title} subtitle={cn('Your pay, benefits and reimbursements ·', ROLE_LABEL[user?.role ?? 'EMPLOYEE'])} />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="YTD gross" value={k.ytdGrossCents} tone="brand" />
          <StatCard label="YTD net" value={k.ytdNetCents} tone="sky" delay={0.05} />
          <StatCard label="YTD taxes" value={k.ytdTaxCents} tone="amber" delay={0.1} hint="Federal + state + FICA" />
          <StatCard label="PTO balance" value={k.ptoBalanceDays} format="number" tone="slate" delay={0.15} hint="days available" />
        </div>

        <FadeIn delay={0.1}>
          <Card className="mt-5 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-100">
                  <Banknote className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Next paycheck</p>
                  <p className="text-xl font-semibold financial text-slate-900">
                    {k.nextPaycheckCents != null ? money(k.nextPaycheckCents) : '—'}
                  </p>
                </div>
              </div>
              <div className="text-right text-xs text-slate-500">
                <p>
                  Estimated net · pay date{' '}
                  <strong className="text-slate-700">{k.nextPayDate ? date(k.nextPayDate) : '—'}</strong>
                </p>
                <p className="mt-0.5">{k.pendingExpenses} expense(s) pending review</p>
              </div>
            </div>
          </Card>
        </FadeIn>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <FadeIn className="lg:col-span-2">
            <Card>
              <CardHeader title="Earnings this year" subtitle="Gross vs net per completed run" />
              <div className="px-3 py-4">
                <EarningsLine
                  data={(data.series ?? []).map((p) => ({
                    label: date(p.periodEnd),
                    grossCents: p.gross,
                    netCents: p.net,
                    taxesCents: p.taxes,
                  }))}
                />
              </div>
            </Card>
          </FadeIn>
          <FadeIn delay={0.08}>
            <Card className="h-full">
              <CardHeader title="Recent pay stubs" subtitle="Watermarked PDF (simulated)" />
              <Stagger className="divide-y divide-slate-50">
                {(data.recentStubs ?? []).map((s) => (
                  <StaggerItem key={s.runId}>
                    <Link
                      href="/payroll"
                      className="flex items-center justify-between px-5 py-3 transition-colors hover:bg-slate-50"
                    >
                      <span className="text-xs text-slate-600">{date(s.periodEnd)}</span>
                      <span className="financial text-sm font-medium text-slate-800">{money(s.netPay)}</span>
                    </Link>
                  </StaggerItem>
                ))}
                {(data.recentStubs ?? []).length === 0 && (
                  <p className="px-5 py-8 text-center text-xs text-slate-400">No stubs yet</p>
                )}
              </Stagger>
            </Card>
          </FadeIn>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Contractor variant
  // -----------------------------------------------------------------------
  const k = data.kpis;
  return (
    <div>
      <PageTitle title={title} subtitle={cn('Invoices and payments ·', ROLE_LABEL[user?.role ?? 'CONTRACTOR'])} />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Unpaid invoices" value={k.unpaidCents} tone="amber" hint={`${k.unpaidCount ?? 0} awaiting payment`} />
        <StatCard label="Paid YTD" value={k.paidYtdCents} tone="brand" delay={0.05} />
        <StatCard
          label="Payment terms"
          value={null}
          tone="slate"
          delay={0.1}
          hint={data.profile?.paymentTerms ?? 'Net 15'}
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <FadeIn>
          <Card>
            <CardHeader
              title="Your invoices"
              subtitle="Submit → approve → paid via simulated ACH"
              action={
                <Link href="/invoices" className="text-xs font-medium text-brand-600 hover:underline">
                  Manage →
                </Link>
              }
            />
            <Stagger className="divide-y divide-slate-50">
              {(data.invoices ?? []).map((i) => (
                <StaggerItem key={i.id}>
                  <div className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-700">{i.description}</p>
                      <p className="text-[11px] text-slate-400">
                        {i.transferStatus === 'FAILED' && i.failureCode
                          ? `ACH returned ${i.failureCode} — retriable`
                          : 'Approved invoices settle automatically'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="financial text-sm font-medium text-slate-800">{money(i.amountCents)}</span>
                      <Badge layoutId={`inv-${i.id}`} tone={statusTone(i.status)}>
                        {i.status}
                      </Badge>
                    </div>
                  </div>
                </StaggerItem>
              ))}
              {(data.invoices ?? []).length === 0 && (
                <p className="px-5 py-8 text-center text-xs text-slate-400">No invoices yet</p>
              )}
            </Stagger>
          </Card>
        </FadeIn>
        <FadeIn delay={0.08}>
          <Card className="h-full">
            <CardHeader title="Payment feed" subtitle="ACH transfer outcomes" />
            <Stagger className="divide-y divide-slate-50">
              {(data.payments ?? []).map((p) => (
                <StaggerItem key={p.id}>
                  <div className="flex items-center justify-between px-5 py-3">
                    <div>
                      <p className="financial text-sm font-medium text-slate-800">{money(p.amountCents)}</p>
                      <p className="text-[11px] text-slate-400">{dateTime(p.createdAt)}</p>
                    </div>
                    <Badge layoutId={`pay-${p.id}`} tone={statusTone(p.status)}>
                      {p.status}
                      {p.failureCode ? ` · ${p.failureCode}` : ''}
                    </Badge>
                  </div>
                </StaggerItem>
              ))}
              {(data.payments ?? []).length === 0 && (
                <p className="px-5 py-8 text-center text-xs text-slate-400">No payments yet</p>
              )}
            </Stagger>
          </Card>
        </FadeIn>
      </div>
    </div>
  );
}
