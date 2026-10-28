'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Banknote, CheckCircle2, FileText, Play, ShieldAlert, XCircle } from 'lucide-react';
import { api, useApi } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn, dateTime, money, periodLabel } from '@/lib/format';
import { Badge, Button, Card, CardHeader, EmptyState, Input, Skeleton, statusTone, Table, Td, Th, toast } from '@/components/ui';
import { PageHeader } from '@/components/drawer';
import { Stagger, StaggerItem, easeOut } from '@/components/motion';

interface RunDetail {
  id: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  status: string;
  runDate?: string | null;
  journalTxnId?: string | null;
  failureReason?: string | null;
  createdBy?: { name: string; email: string } | null;
  approvedBy?: { name: string; email: string } | null;
  lineItems: Array<{
    id: string;
    employeeId: string;
    grossPay: number;
    federalTax: number;
    stateTax: number;
    ficaSs: number;
    ficaMedicare: number;
    preTaxDeductions: number;
    postTaxDeductions: number;
    expenseReimbursement: number;
    netPay: number;
    employee: { id: string; name: string; departmentId?: string | null };
  }>;
}

export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useSession();
  const { data: run, loading, error, refresh } = useApi<RunDetail>(`/payroll/runs/${params.id}`, {
    pollMs: 2500,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const act = async (name: string, path: string, okMsg: string) => {
    setBusy(name);
    try {
      await api(path, { method: 'POST', json: name === 'reject' ? { reason } : undefined });
      toast(okMsg);
      refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Action failed';
      toast(msg, 'error');
    } finally {
      setBusy(null);
      if (name === 'reject') setRejecting(false);
    }
  };

  if (loading && !run) {
    return (
      <div>
        <Skeleton className="mb-6 h-8 w-72" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (error || !run) return <EmptyState title="Run not found" hint={error ?? 'It may belong to another tenant.'} />;

  const role = user?.role ?? 'EMPLOYEE';
  const canSubmit = ['COMPANY_ADMIN', 'HR_MANAGER', 'PLATFORM_ADMIN'].includes(role) && run.status === 'DRAFT';
  const canApprove = ['COMPANY_ADMIN', 'PLATFORM_ADMIN'].includes(role) && run.status === 'PENDING_APPROVAL';
  const canProcess = ['COMPANY_ADMIN', 'PLATFORM_ADMIN'].includes(role) && run.status === 'APPROVED';

  const totals = run.lineItems.reduce(
    (acc, l) => ({
      gross: acc.gross + l.grossPay,
      federal: acc.federal + l.federalTax,
      state: acc.state + l.stateTax,
      ficaSs: acc.ficaSs + l.ficaSs,
      ficaMed: acc.ficaMed + l.ficaMedicare,
      net: acc.net + l.netPay,
    }),
    { gross: 0, federal: 0, state: 0, ficaSs: 0, ficaMed: 0, net: 0 },
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => router.push('/payroll')}
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All runs
      </button>

      <PageHeader
        title={periodLabel(run.payPeriodStart, run.payPeriodEnd)}
        subtitle={
          <span className="inline-flex items-center gap-2">
            <Badge layoutId={`run-detail-${run.id}`} tone={statusTone(run.status)}>
              {run.status.replace('_', ' ')}
            </Badge>
            {run.journalTxnId && <span className="text-xs text-brand-600">journal posted ✓</span>}
            {run.failureReason && <span className="text-xs text-rose-600">{run.failureReason}</span>}
          </span>
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <AnimatePresence mode="popLayout">
              {canSubmit && (
                <motion.div key="submit" layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}>
                  <Button onClick={() => act('submit', `/payroll/runs/${run.id}/submit`, 'Run submitted for approval')} disabled={busy !== null}>
                    {busy === 'submit' ? 'Submitting…' : 'Submit'}
                  </Button>
                </motion.div>
              )}
              {canApprove && (
                <motion.div key="approve" layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="flex gap-2">
                  <Button variant="secondary" onClick={() => setRejecting(true)} disabled={busy !== null}>
                    <XCircle className="h-4 w-4" /> Reject
                  </Button>
                  <Button onClick={() => act('approve', `/payroll/runs/${run.id}/approve`, 'Run approved')} disabled={busy !== null}>
                    <CheckCircle2 className="h-4 w-4" /> {busy === 'approve' ? 'Approving…' : 'Approve'}
                  </Button>
                </motion.div>
              )}
              {canProcess && (
                <motion.div key="process" layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}>
                  <Button onClick={() => act('process', `/payroll/runs/${run.id}/process`, 'Processing started — journal, stubs and ACH transfers queued')} disabled={busy !== null}>
                    <Play className="h-4 w-4" /> {busy === 'process' ? 'Starting…' : 'Process run'}
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        }
      />

      {/* Reject dialog (AnimatePresence collapse) */}
      <AnimatePresence>
        {rejecting && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={easeOut}
            className="mb-4 overflow-hidden"
          >
            <Card className="flex flex-wrap items-center gap-3 border-amber-200 bg-amber-50/60 p-4">
              <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
              <Input
                placeholder="Rejection reason (required)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="max-w-sm bg-white"
              />
              <Button
                variant="secondary"
                disabled={!reason.trim() || busy !== null}
                onClick={() => act('reject', `/payroll/runs/${run.id}/reject`, 'Run rejected')}
              >
                Confirm rejection
              </Button>
              <Button variant="ghost" onClick={() => setRejecting(false)}>
                Cancel
              </Button>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Totals strip */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-6">
        {[
          { label: 'Gross', value: totals.gross },
          { label: 'Federal', value: totals.federal },
          { label: 'State', value: totals.state },
          { label: 'Soc. Sec.', value: totals.ficaSs },
          { label: 'Medicare', value: totals.ficaMed },
          { label: 'Net pay', value: totals.net },
        ].map((x, i) => (
          <motion.div
            key={x.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...easeOut, delay: i * 0.04 }}
            className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-sm"
          >
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{x.label}</p>
            <p className="financial mt-1 text-sm font-semibold text-slate-800">{money(x.value)}</p>
          </motion.div>
        ))}
      </div>

      <Card>
        <CardHeader
          title="Line items"
          subtitle={`${run.lineItems.length} employees · engine snapshot stored per line for auditability`}
          action={
            run.journalTxnId ? (
              <Link href="/ledger" className="text-xs font-medium text-brand-600 hover:underline">
                View journal →
              </Link>
            ) : undefined
          }
        />
        <Table>
          <thead>
            <tr>
              <Th>Employee</Th>
              <Th className="text-right">Gross</Th>
              <Th className="text-right">Federal</Th>
              <Th className="text-right">State</Th>
              <Th className="text-right">FICA</Th>
              <Th className="text-right">Net</Th>
            </tr>
          </thead>
          <tbody>
            {run.lineItems.map((l, i) => (
              <motion.tr
                key={l.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: Math.min(i * 0.02, 0.4) }}
                className="hover:bg-slate-50/70"
              >
                <Td className="font-medium text-slate-800">{l.employee.name}</Td>
                <Td className="text-right financial">{money(l.grossPay)}</Td>
                <Td className="text-right financial text-slate-500">{money(l.federalTax)}</Td>
                <Td className="text-right financial text-slate-500">{money(l.stateTax)}</Td>
                <Td className="text-right financial text-slate-500">{money(l.ficaSs + l.ficaMedicare)}</Td>
                <Td className="text-right financial font-semibold text-slate-900">{money(l.netPay)}</Td>
              </motion.tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Banknote className="h-4 w-4 text-brand-500" /> ACH transfers
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            One transfer per employee net pay — initiated at finalization, settles asynchronously.
          </p>
          <Link href={`/transfers?runId=${run.id}`} className="mt-3 inline-block text-xs font-medium text-brand-600 hover:underline">
            Open transfer ledger →
          </Link>
        </Card>
        <Card className="p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <FileText className="h-4 w-4 text-brand-500" /> Pay stubs
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            {run.status === 'COMPLETED'
              ? 'PDF stubs generated for every employee (watermarked SIMULATED — NOT FOR FILING).'
              : 'Stubs are generated when the run completes.'}
          </p>
          {run.status === 'COMPLETED' && run.lineItems[0] && (
            <a
              href={`/api/v1/payroll/runs/${run.id}/stubs/${run.lineItems[0].employeeId}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-xs font-medium text-brand-600 hover:underline"
            >
              Preview first stub →
            </a>
          )}
        </Card>
      </div>

      <p className="mt-4 text-[11px] text-slate-400">
        Created by {run.createdBy?.email ?? '—'}
        {run.approvedBy ? ` · approved by ${run.approvedBy.email}` : ''}
        {run.runDate ? ` · run date ${dateTime(run.runDate)}` : ''}
      </p>
    </div>
  );
}
