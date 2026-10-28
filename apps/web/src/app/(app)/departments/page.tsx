'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Building2, Plus } from 'lucide-react';
import { api, useApi, type Paged } from '@/lib/api';
import { useSession } from '@/lib/session';
import { moneyShort } from '@/lib/format';
import { Button, Card, EmptyState, Input, Skeleton, toast } from '@/components/ui';
import { Drawer, PageHeader } from '@/components/drawer';
import { Stagger, StaggerItem, easeOut } from '@/components/motion';

interface Department {
  id: string;
  name: string;
  budgetCents: number;
  _count?: { employees: number; expenses: number };
}

export default function DepartmentsPage() {
  const { user } = useSession();
  const canWrite = user && ['COMPANY_ADMIN', 'HR_MANAGER', 'PLATFORM_ADMIN'].includes(user.role);
  const { data, loading, refresh } = useApi<Paged<Department>>('/departments?pageSize=100');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', budgetCents: 2_000_000 });

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/departments', { method: 'POST', json: { ...form, budgetCents: Number(form.budgetCents) } });
      toast(`Department “${form.name}” created`);
      setOpen(false);
      setForm({ ...form, name: '' });
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not create department', 'error');
    } finally {
      setBusy(false);
    }
  };

  const items = data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Departments"
        subtitle="Cost centers with budgets — expense spend rolls up here for the dashboard"
        action={
          canWrite ? (
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> New department
            </Button>
          ) : undefined
        }
      />

      {loading && !data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState title="No departments" icon={<Building2 className="h-5 w-5" />} />
        </Card>
      ) : (
        <Stagger className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((d) => (
            <StaggerItem key={d.id}>
              <Card hover className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{d.name}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {d._count?.employees ?? 0} employees · {d._count?.expenses ?? 0} expenses
                    </p>
                  </div>
                  <span className="rounded-lg bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-700 ring-1 ring-inset ring-brand-100 financial">
                    {moneyShort(d.budgetCents)} budget
                  </span>
                </div>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <motion.div
                    className="h-full rounded-full bg-brand-500"
                    initial={{ width: 0 }}
                    animate={{ width: '38%' }}
                    transition={{ ...easeOut, duration: 0.8 }}
                  />
                </div>
                <p className="mt-1.5 text-[10px] text-slate-400">Budget utilization tracked on the dashboard</p>
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
      )}

      <Drawer open={open} onClose={() => setOpen(false)} title="New department">
        <form onSubmit={create} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Name</label>
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Budget ($)</label>
            <Input
              type="number"
              min={0}
              value={form.budgetCents / 100}
              onChange={(e) => setForm({ ...form, budgetCents: Math.round(Number(e.target.value) * 100) })}
            />
          </div>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Creating…' : 'Create department'}
          </Button>
        </form>
      </Drawer>
    </div>
  );
}
