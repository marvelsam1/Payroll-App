'use client';

import Link from 'next/link';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, FileText, Plus, Sparkles } from 'lucide-react';
import { api, useApi, type Paged } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn, date, money, periodLabel } from '@/lib/format';
import { Badge, Button, Card, EmptyState, Input, Select, Skeleton, statusTone, Table, Td, Th, toast } from '@/components/ui';
import { Drawer, PageHeader } from '@/components/drawer';
import { Stagger, StaggerItem, easeOut } from '@/components/motion';

interface Run {
  id: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  status: string;
  runDate?: string | null;
  journalTxnId?: string | null;
  lineItems?: Array<{ grossPay: number; netPay: number; employee: { id: string; name: string } }>;
}

interface PreviewLine {
  employeeId: string;
  employeeName?: string;
  grossPay: number;
  federalTax: number;
  stateTax: number;
  ficaSs: number;
  ficaMedicare: number;
  netPay: number;
}

interface PreviewResult {
  lines: PreviewLine[];
  totals: { grossPay: number; federalTax: number; ficaSs: number; ficaMedicare: number; netPay: number };
  frequency: string;
  hasNegativeNet: boolean;
}

const STATUS_FILTERS = ['', 'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PROCESSING', 'COMPLETED'];

export default function PayrollPage() {
  const { user } = useSession();
  const isEmployee = user?.role === 'EMPLOYEE';
  const [status, setStatus] = useState('');
  const path = isEmployee ? '/payroll/my-paystubs' : `/payroll/runs${status ? `?status=${status}` : ''}`;
  const { data, loading, refresh } = useApi<Paged<Run> | Array<{ runId: string; periodStart: string; periodEnd: string; payDate: string; grossPay: number; federalTax: number; stateTax: number; ficaSs: number; ficaMedicare: number; netPay: number }>>(path);
  const { data: dashboard } = useApi<Record<string, any>>(isEmployee ? '/dashboard' : null);

  const canCreate = user && ['COMPANY_ADMIN', 'HR_MANAGER', 'PLATFORM_ADMIN'].includes(user.role);
  const [newOpen, setNewOpen] = useState(false);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState(false);

  const runPreview = async () => {
    if (!periodStart || !periodEnd) return;
    setBusy(true);
    try {
      const res = await api<PreviewResult>('/payroll/preview', {
        method: 'POST',
        json: { periodStart, periodEnd },
      });
      setPreview(res);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Preview failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const createRun = async () => {
    if (!periodStart || !periodEnd) return;
    setBusy(true);
    try {
      const run = await api<Run>('/payroll/runs', { method: 'POST', json: { periodStart, periodEnd } });
      toast(`Draft run created for ${periodLabel(periodStart, periodEnd)}`);
      setNewOpen(false);
      setPreview(null);
      refresh();
      window.location.href = `/payroll/${run.id}`;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not create run', 'error');
    } finally {
      setBusy(false);
    }
  };

  // -------------------------------------------------------------------------
  // Employee view — my pay stubs
  // -------------------------------------------------------------------------
  if (isEmployee) {
    const stubs = (data as Array<Record<string, any>>) ?? [];
    const employeeId = dashboard?.profile?.id as string | undefined;
    return (
      <div>
        <PageHeader title="My payroll" subtitle="Pay stubs from completed runs (simulated PDFs)" />
        <Card>
          <Stagger className="divide-y divide-slate-50">
            {stubs.map((s) => (
              <StaggerItem key={s.runId}>
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{periodLabel(s.periodStart, s.periodEnd)}</p>
                    <p className="text-[11px] text-slate-400">Pay date {date(s.payDate)}</p>
                  </div>
                  <div className="flex items-center gap-5 text-sm">
                    <span className="financial text-slate-500">gross {money(s.grossPay)}</span>
                    <span className="financial font-semibold text-slate-900">net {money(s.netPay)}</span>
                    <StubLink runId={s.runId} employeeId={employeeId} />
                  </div>
                </div>
              </StaggerItem>
            ))}
            {!loading && stubs.length === 0 && (
              <EmptyState title="No pay stubs yet" hint="Stubs appear once a payroll run completes." />
            )}
            {loading && <Skeleton className="m-4 h-16" />}
          </Stagger>
        </Card>
      </div>
    );
  }

  const runs = (data as Paged<Run>)?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Payroll"
        subtitle="Preview → draft → submit → approve → process. Negative net pay is blocked at approval."
        action={
          canCreate ? (
            <Button onClick={() => setNewOpen(true)}>
              <Plus className="h-4 w-4" /> New run
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => setStatus(s)}
            className={cn(
              'rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors',
              status === s ? 'bg-slate-900 text-white shadow-sm' : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50',
            )}
          >
            {s ? s.replace('_', ' ') : 'All runs'}
          </button>
        ))}
      </div>

      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Pay period</Th>
              <Th>Status</Th>
              <Th>Lines</Th>
              <Th>Journal</Th>
              <Th>Run date</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {runs.map((run) => (
                <motion.tr
                  key={run.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={easeOut}
                  className="group transition-colors hover:bg-slate-50/70"
                >
                  <Td>
                    <Link href={`/payroll/${run.id}`} className="font-medium text-slate-800 hover:text-brand-600">
                      {periodLabel(run.payPeriodStart, run.payPeriodEnd)}
                    </Link>
                  </Td>
                  <Td>
                    <Badge layoutId={`run-${run.id}`} tone={statusTone(run.status)}>
                      {run.status.replace('_', ' ')}
                    </Badge>
                  </Td>
                  <Td className="financial">{run.lineItems?.length ?? '—'}</Td>
                  <Td className="text-xs text-slate-400">{run.journalTxnId ? 'posted ✓' : '—'}</Td>
                  <Td className="text-xs">{run.runDate ? date(run.runDate) : '—'}</Td>
                  <Td className="text-right">
                    <Link
                      href={`/payroll/${run.id}`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      Open <ArrowRight className="h-3 w-3" />
                    </Link>
                  </Td>
                </motion.tr>
              ))}
            </AnimatePresence>
            {loading &&
              [0, 1, 2].map((i) => (
                <tr key={i}>
                  <Td colSpan={6}>
                    <Skeleton className="h-9" />
                  </Td>
                </tr>
              ))}
          </tbody>
        </Table>
        {!loading && runs.length === 0 && (
          <EmptyState
            title="No payroll runs"
            hint="Create a draft run to preview engine-computed taxes before approval."
            icon={<FileText className="h-5 w-5" />}
          />
        )}
      </Card>

      {/* New run drawer: preview + create */}
      <Drawer
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="New payroll run"
        subtitle="Preview is computed with the real 2024 tax engine"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Period start</label>
              <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Period end</label>
              <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </div>
          </div>

          <Button variant="secondary" onClick={runPreview} disabled={busy || !periodStart || !periodEnd} className="w-full">
            <Sparkles className="h-4 w-4" /> {busy && !preview ? 'Computing…' : 'Run preview'}
          </Button>

          <AnimatePresence>
            {preview && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={easeOut}>
                <Card className="p-4">
                  <div className="grid grid-cols-3 gap-3 text-center">
                    {[
                      { label: 'Gross', value: preview.totals.grossPay },
                      { label: 'Employee taxes', value: preview.totals.federalTax + preview.totals.ficaSs + preview.totals.ficaMedicare },
                      { label: 'Net', value: preview.totals.netPay },
                    ].map((x) => (
                      <div key={x.label}>
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">{x.label}</p>
                        <p className="financial text-sm font-semibold text-slate-800">{money(x.value)}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-center text-[11px] text-slate-400">
                    {preview.lines.length} employees · {preview.frequency}
                  </p>
                  {preview.hasNegativeNet && (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-center text-xs font-medium text-rose-700"
                    >
                      ⚠ Negative net pay detected — submission will be rejected (422)
                    </motion.p>
                  )}
                </Card>
                <Button onClick={createRun} disabled={busy} className="mt-4 w-full">
                  Create draft run
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Drawer>
    </div>
  );
}

function StubLink({ runId, employeeId }: { runId: string; employeeId?: string }) {
  if (!employeeId) {
    return <span className="text-[11px] text-slate-400">stub…</span>;
  }
  return (
    <a
      href={`/api/v1/payroll/runs/${runId}/stubs/${employeeId}/pdf`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:border-brand-300 hover:text-brand-700"
    >
      <FileText className="h-3.5 w-3.5" /> PDF
    </a>
  );
}
