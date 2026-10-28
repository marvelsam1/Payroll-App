'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCcw, Zap } from 'lucide-react';
import { api, useApi, type Paged } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn, dateTime, money } from '@/lib/format';
import { Badge, Button, Card, CardHeader, EmptyState, Select, Skeleton, statusTone, Table, Td, Th, toast } from '@/components/ui';
import { PageHeader } from '@/components/drawer';
import { Stagger, StaggerItem, easeOut } from '@/components/motion';

interface Transfer {
  id: string;
  amountCents: number;
  status: string;
  failureCode?: string | null;
  attempt: number;
  createdAt: string;
  settledAt?: string | null;
  employee?: { name: string } | null;
  invoice?: { description: string } | null;
  payrollRun?: { id: string; payPeriodEnd: string } | null;
}

const STATUSES = ['', 'PENDING', 'PROCESSING', 'SETTLED', 'FAILED'];

export default function TransfersPage() {
  const { user } = useSession();
  const canManage = user && ['COMPANY_ADMIN', 'PLATFORM_ADMIN'].includes(user.role);
  const [status, setStatus] = useState('');
  const [runId, setRunId] = useState('');

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('runId');
    if (q) setRunId(q);
  }, []);

  const qs = `${status ? `status=${status}` : ''}${status && runId ? '&' : ''}${runId ? `payrollRunId=${runId}` : ''}`;
  const { data, loading, refresh } = useApi<Paged<Transfer>>(`/transfers${qs ? `?${qs}` : ''}`, {
    pollMs: 4000,
  });
  const { data: codes } = useApi<Array<{ code: string; meaning: string }>>('/transfers/failure-codes');

  const [retrying, setRetrying] = useState<string | null>(null);
  const retry = async (id: string) => {
    setRetrying(id);
    try {
      const t = await api<Transfer>(`/transfers/${id}/retry`, { method: 'POST', json: { reason: 'manual retry from UI' } });
      toast(`Retry initiated — new attempt #${t.attempt ?? 2}`);
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Retry failed', 'error');
    } finally {
      setRetrying(null);
    }
  };

  const items = data?.items ?? [];
  const inFlight = items.some((t) => t.status === 'PENDING' || t.status === 'PROCESSING' || t.status === 'INITIATED');

  return (
    <div>
      <PageHeader
        title="ACH transfers"
        subtitle={
          <>
            Simulated rails: initiated → pending → processing → settled / failed. Auto-refreshes
            {inFlight ? ' · in-flight right now' : ''}.
          </>
        }
        action={
          <Button variant="secondary" onClick={refresh}>
            <RefreshCcw className={cn('h-4 w-4', loading && 'animate-spin')} /> Refresh
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {STATUSES.map((s) => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => setStatus(s)}
            className={cn(
              'rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors',
              status === s ? 'bg-slate-900 text-white shadow-sm' : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50',
            )}
          >
            {s || 'All'}
          </button>
        ))}
        {runId && (
          <button
            type="button"
            onClick={() => setRunId('')}
            className="rounded-full bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-100"
          >
            payroll filter ×
          </button>
        )}
      </div>

      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Created</Th>
              <Th>Destination</Th>
              <Th className="text-right">Amount</Th>
              <Th>Status</Th>
              <Th>Attempt</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {items.map((t) => (
                <motion.tr
                  key={t.id}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={easeOut}
                  className="hover:bg-slate-50/70"
                >
                  <Td className="whitespace-nowrap text-xs">{dateTime(t.createdAt)}</Td>
                  <Td className="max-w-[240px] truncate text-slate-700">
                    {t.employee?.name ?? t.invoice?.description ?? '—'}
                  </Td>
                  <Td className="text-right financial font-medium">{money(t.amountCents)}</Td>
                  <Td>
                    <Badge layoutId={`t-${t.id}`} tone={statusTone(t.status)}>
                      {t.status}
                      {t.failureCode ? ` · ${t.failureCode}` : ''}
                    </Badge>
                  </Td>
                  <Td className="text-xs text-slate-500">#{t.attempt}</Td>
                  <Td className="text-right">
                    {t.status === 'FAILED' && canManage ? (
                      <Button size="sm" variant="secondary" disabled={retrying === t.id} onClick={() => retry(t.id)}>
                        <RefreshCcw className={cn('h-3.5 w-3.5', retrying === t.id && 'animate-spin')} />
                        {retrying === t.id ? 'Retrying…' : 'Retry'}
                      </Button>
                    ) : t.settledAt ? (
                      <span className="text-[11px] text-slate-400">{dateTime(t.settledAt)}</span>
                    ) : null}
                  </Td>
                </motion.tr>
              ))}
            </AnimatePresence>
            {loading &&
              [0, 1, 2, 3].map((i) => (
                <tr key={i}>
                  <Td colSpan={6}>
                    <Skeleton className="h-8" />
                  </Td>
                </tr>
              ))}
          </tbody>
        </Table>
        {!loading && items.length === 0 && (
          <EmptyState title="No transfers" hint="Payroll processing and invoice pay-batches create ACH transfers." />
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader title="Failure code catalogue" subtitle="What returned items mean — surfaced in the UI and API" />
        <Stagger className="grid gap-3 p-5 sm:grid-cols-3">
          {(codes ?? []).map((c) => (
            <StaggerItem key={c.code}>
              <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                  <Zap className="h-3.5 w-3.5 text-amber-500" /> {c.code}
                </p>
                <p className="mt-1 text-xs text-slate-500">{c.meaning}</p>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </Card>
    </div>
  );
}
