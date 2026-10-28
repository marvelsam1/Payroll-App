'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Receipt, Send, X } from 'lucide-react';
import { api, useApi, type Paged } from '@/lib/api';
import { useSession } from '@/lib/session';
import { date, money } from '@/lib/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Select,
  Skeleton,
  statusTone,
  Table,
  Td,
  Th,
  toast,
} from '@/components/ui';
import { Drawer, PageHeader } from '@/components/drawer';
import { easeOut } from '@/components/motion';

interface Expense {
  id: string;
  amountCents: number;
  category: string;
  description: string;
  status: string;
  expenseDate: string;
  reimbursementMode: string;
  rejectionReason?: string | null;
  submittedBy?: { name: string; email: string } | null;
  department?: { id: string; name: string } | null;
  submittedById: string;
}

interface Department {
  id: string;
  name: string;
}

export default function ExpensesPage() {
  const { user } = useSession();
  const canApprove = user && ['COMPANY_ADMIN', 'HR_MANAGER', 'PLATFORM_ADMIN'].includes(user.role);
  const [status, setStatus] = useState('');
  const qs = status ? `?status=${status}&pageSize=100` : '?pageSize=100';
  const { data, loading, refresh } = useApi<Paged<Expense>>(`/expenses${qs}`);
  const { data: depts } = useApi<Paged<Department>>('/departments?pageSize=100');

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({
    amountCents: 75_00,
    category: 'Software',
    description: '',
    departmentId: '',
    reimbursementMode: 'STANDALONE',
  });

  const submitNew = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('create');
    try {
      await api('/expenses', {
        method: 'POST',
        json: { ...form, amountCents: Number(form.amountCents), departmentId: form.departmentId || undefined },
      });
      toast('Expense submitted for review');
      setOpen(false);
      setForm({ ...form, description: '' });
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Submit failed', 'error');
    } finally {
      setBusy(null);
    }
  };

  const action = async (id: string, verb: 'approve' | 'reject' | 'reimburse') => {
    setBusy(`${verb}-${id}`);
    try {
      if (verb === 'reject') {
        const reason = window.prompt('Rejection reason?');
        if (!reason) return;
        await api(`/expenses/${id}/reject`, { method: 'POST', json: { reason } });
        toast('Expense rejected');
      } else {
        await api(`/expenses/${id}/${verb}`, { method: 'POST' });
        toast(verb === 'approve' ? 'Expense approved — journal posted' : 'Reimbursed — payable cleared');
      }
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Action failed', 'error');
    } finally {
      setBusy(null);
    }
  };

  const items = data?.items ?? [];
  const pending = items.filter((e) => e.status === 'SUBMITTED').length;

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle={
          canApprove
            ? `${pending} awaiting review · approvals post REIMBURSABLE_EXPENSE journals`
            : 'Track submissions and reimbursements against department budgets'
        }
        action={
          <Button onClick={() => setOpen(true)}>
            <Send className="h-4 w-4" /> Submit expense
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {['', 'SUBMITTED', 'APPROVED', 'REIMBURSED', 'REJECTED'].map((s) => (
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
              <Th>Date</Th>
              <Th>Expense</Th>
              <Th>Department</Th>
              <Th>Submitter</Th>
              <Th className="text-right">Amount</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {items.map((x, i) => (
                <motion.tr
                  key={x.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i * 0.02, 0.3) } }}
                  exit={{ opacity: 0 }}
                  transition={easeOut}
                  className="hover:bg-slate-50/70"
                >
                  <Td className="whitespace-nowrap text-xs">{date(x.expenseDate)}</Td>
                  <Td>
                    <p className="font-medium text-slate-800">{x.category}</p>
                    <p className="max-w-[260px] truncate text-[11px] text-slate-400">
                      {x.description || '—'}
                      {x.rejectionReason ? ` · “${x.rejectionReason}”` : ''}
                    </p>
                  </Td>
                  <Td className="text-xs">{x.department?.name ?? '—'}</Td>
                  <Td className="text-xs text-slate-500">{x.submittedBy?.name ?? '—'}</Td>
                  <Td className="text-right financial font-medium">{money(x.amountCents)}</Td>
                  <Td>
                    <Badge layoutId={`exp-${x.id}`} tone={statusTone(x.status)}>
                      {x.status}
                    </Badge>
                    <span className="ml-1.5 hidden text-[10px] text-slate-400 sm:inline">
                      {x.reimbursementMode === 'DEFER_TO_PAYROLL' ? 'via payroll' : 'standalone'}
                    </span>
                  </Td>
                  <Td className="text-right">
                    {canApprove && x.status === 'SUBMITTED' ? (
                      <span className="inline-flex gap-1.5">
                        <Button
                          size="sm"
                          variant="soft"
                          disabled={busy === `approve-${x.id}`}
                          onClick={() => action(x.id, 'approve')}
                        >
                          <Check className="h-3.5 w-3.5" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-rose-500 hover:bg-rose-50"
                          disabled={busy === `reject-${x.id}`}
                          onClick={() => action(x.id, 'reject')}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </span>
                    ) : canApprove && x.status === 'APPROVED' && x.reimbursementMode === 'STANDALONE' ? (
                      <Button size="sm" variant="secondary" disabled={busy === `reimburse-${x.id}`} onClick={() => action(x.id, 'reimburse')}>
                        Reimburse
                      </Button>
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
          <EmptyState title="No expenses" hint="Submit one — receipts are optional in the simulation." icon={<Receipt className="h-5 w-5" />} />
        )}
      </Card>

      <Drawer open={open} onClose={() => setOpen(false)} title="Submit expense" subtitle="Reviews happen against department budgets">
        <form onSubmit={submitNew} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
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
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Category</label>
              <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {['Software', 'Travel', 'Meals', 'Office', 'Equipment', 'Training'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Description</label>
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What was this for?" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Department</label>
              <Select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                <option value="">Unassigned</option>
                {(depts?.items ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Reimbursement</label>
              <Select value={form.reimbursementMode} onChange={(e) => setForm({ ...form, reimbursementMode: e.target.value })}>
                <option value="STANDALONE">Standalone (ACH)</option>
                <option value="DEFER_TO_PAYROLL">Defer to payroll</option>
              </Select>
            </div>
          </div>
          <Button type="submit" disabled={busy !== null} className="w-full">
            {busy === 'create' ? 'Submitting…' : 'Submit expense'}
          </Button>
        </form>
      </Drawer>
    </div>
  );
}
