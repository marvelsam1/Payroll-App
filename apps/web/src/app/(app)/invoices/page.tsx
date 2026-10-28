'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, FileText, Send, XCircle } from 'lucide-react';
import { api, useApi, type Paged } from '@/lib/api';
import { useSession } from '@/lib/session';
import { date, money, periodLabel } from '@/lib/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Skeleton,
  statusTone,
  Table,
  Td,
  Th,
  toast,
} from '@/components/ui';
import { Drawer, PageHeader } from '@/components/drawer';
import { easeOut } from '@/components/motion';

interface Invoice {
  id: string;
  amountCents: number;
  description: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  submittedAt: string;
  paidAt?: string | null;
  rejectionReason?: string | null;
  contractor?: { name: string; businessName?: string | null } | null;
}

export default function InvoicesPage() {
  const { user } = useSession();
  const canSubmit = !!user;
  const canApprove = user && ['COMPANY_ADMIN', 'PLATFORM_ADMIN'].includes(user.role);
  const [status, setStatus] = useState('');
  const { data, loading, refresh } = useApi<Paged<Invoice>>(
    `/invoices?pageSize=100${status ? `&status=${status}` : ''}`,
    { pollMs: 6000 },
  );

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({
    description: '',
    amountCents: 150_000,
    periodStart: '',
    periodEnd: '',
  });

  const submitNew = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('create');
    try {
      await api('/invoices', { method: 'POST', json: { ...form, amountCents: Number(form.amountCents) } });
      toast('Invoice submitted');
      setOpen(false);
      setForm({ ...form, description: '' });
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Submit failed', 'error');
    } finally {
      setBusy(null);
    }
  };

  const act = async (id: string, verb: 'approve' | 'reject') => {
    setBusy(`${verb}-${id}`);
    try {
      if (verb === 'reject') {
        const reason = window.prompt('Rejection reason?');
        if (!reason) return;
        await api(`/invoices/${id}/reject`, { method: 'POST', json: { reason } });
        toast('Invoice rejected');
      } else {
        await api(`/invoices/${id}/approve`, { method: 'POST' });
        toast('Invoice approved — contractor payable journal posted');
      }
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Action failed', 'error');
    } finally {
      setBusy(null);
    }
  };

  const payBatch = async () => {
    if (selected.size === 0) return;
    setBusy('batch');
    try {
      const res = await api<{ results: Array<{ invoiceId: string; transferId?: string; error?: string }> }>(
        '/invoices/pay-batch',
        { method: 'POST', json: { invoiceIds: [...selected] } },
      );
      const okCount = res.results.filter((r) => r.transferId).length;
      toast(`${okCount} ACH transfer(s) initiated`);
      setSelected(new Set());
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Pay batch failed', 'error');
    } finally {
      setBusy(null);
    }
  };

  const items = data?.items ?? [];
  const payable = items.filter((i) => i.status === 'APPROVED');

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div>
      <PageHeader
        title="Contractor invoices"
        subtitle={
          canApprove
            ? `${items.filter((i) => i.status === 'SUBMITTED').length} submitted · ${payable.length} approved & payable`
            : 'Submit invoices and track payment through simulated ACH'
        }
        action={
          <div className="flex gap-2">
            {canApprove && (
              <Button variant="soft" onClick={payBatch} disabled={selected.size === 0 || busy !== null}>
                <Send className="h-4 w-4" />
                {busy === 'batch' ? 'Initiating…' : `Pay selected (${selected.size})`}
              </Button>
            )}
            {canSubmit && (
              <Button onClick={() => setOpen(true)}>
                <FileText className="h-4 w-4" /> New invoice
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {['', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID'].map((s) => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
              status === s
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {s ? s.toLowerCase() : 'all'}
          </button>
        ))}
      </div>

      <Card>
        <Table>
          <thead>
            <tr>
              {canApprove && <Th className="w-10" />}
              <Th>Period</Th>
              <Th>Description</Th>
              <Th>Contractor</Th>
              <Th className="text-right">Amount</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {items.map((inv, i) => (
                <motion.tr
                  key={inv.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i * 0.02, 0.3) } }}
                  exit={{ opacity: 0 }}
                  transition={easeOut}
                  className="hover:bg-slate-50/70"
                >
                  {canApprove && (
                    <Td>
                      <input
                        type="checkbox"
                        disabled={inv.status !== 'APPROVED'}
                        checked={selected.has(inv.id)}
                        onChange={() => toggle(inv.id)}
                        className="h-4 w-4 rounded border-slate-300 accent-emerald-500 disabled:opacity-30"
                      />
                    </Td>
                  )}
                  <Td className="whitespace-nowrap text-xs">{periodLabel(inv.periodStart, inv.periodEnd)}</Td>
                  <Td className="max-w-[260px]">
                    <p className="truncate font-medium text-slate-800">{inv.description}</p>
                    <p className="text-[11px] text-slate-400">
                      submitted {date(inv.submittedAt)}
                      {inv.paidAt ? ` · paid ${date(inv.paidAt)}` : ''}
                      {inv.rejectionReason ? ` · “${inv.rejectionReason}”` : ''}
                    </p>
                  </Td>
                  <Td className="text-xs">{inv.contractor?.name ?? '—'}</Td>
                  <Td className="text-right financial font-medium">{money(inv.amountCents)}</Td>
                  <Td>
                    <Badge layoutId={`inv-${inv.id}`} tone={statusTone(inv.status)}>
                      {inv.status}
                    </Badge>
                  </Td>
                  <Td className="text-right">
                    {canApprove && inv.status === 'SUBMITTED' ? (
                      <span className="inline-flex gap-1.5">
                        <Button size="sm" variant="soft" disabled={busy === `approve-${inv.id}`} onClick={() => act(inv.id, 'approve')}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-rose-500 hover:bg-rose-50"
                          disabled={busy === `reject-${inv.id}`}
                          onClick={() => act(inv.id, 'reject')}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </Button>
                      </span>
                    ) : null}
                  </Td>
                </motion.tr>
              ))}
            </AnimatePresence>
            {loading &&
              [0, 1, 2].map((i) => (
                <tr key={i}>
                  <Td colSpan={7}>
                    <Skeleton className="h-9" />
                  </Td>
                </tr>
              ))}
          </tbody>
        </Table>
        {!loading && items.length === 0 && (
          <EmptyState title="No invoices" hint="Contractors submit invoices that flow through approval into ACH." />
        )}
      </Card>

      <Drawer open={open} onClose={() => setOpen(false)} title="New invoice" subtitle="No withholding — contractors are 1099">
        <form onSubmit={submitNew} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Description</label>
            <Input required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Amount ($)</label>
            <Input
              type="number"
              min={0.01}
              step="any"
              required
              value={form.amountCents / 100}
              onChange={(e) => setForm({ ...form, amountCents: Math.round(Number(e.target.value) * 100) })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Period start</label>
              <Input type="date" required value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Period end</label>
              <Input type="date" required value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} />
            </div>
          </div>
          <Button type="submit" disabled={busy !== null} className="w-full">
            {busy === 'create' ? 'Submitting…' : 'Submit invoice'}
          </Button>
        </form>
      </Drawer>
    </div>
  );
}
