'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Handshake, UserPlus } from 'lucide-react';
import { api, useApi, type Paged } from '@/lib/api';
import { useSession } from '@/lib/session';
import { money } from '@/lib/format';
import { Badge, Button, Card, EmptyState, Input, Skeleton, Table, Td, Th, toast } from '@/components/ui';
import { Drawer, PageHeader } from '@/components/drawer';
import { easeOut } from '@/components/motion';

interface Contractor {
  id: string;
  name: string;
  businessName?: string | null;
  email?: string | null;
  paymentTerms: string;
  rateCents: number;
  rateUnit: string;
  status: string;
}

export default function ContractorsPage() {
  const { user } = useSession();
  const canWrite = user && ['COMPANY_ADMIN', 'HR_MANAGER', 'PLATFORM_ADMIN'].includes(user.role);
  const { data, loading, refresh } = useApi<Paged<Contractor>>('/contractors?pageSize=100');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: '',
    businessName: '',
    email: '',
    paymentTerms: 'Net 14',
    rateCents: 150_000,
  });

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/contractors', {
        method: 'POST',
        json: { ...form, rateCents: Number(form.rateCents) },
      });
      toast(`${form.name} onboarded`);
      setOpen(false);
      setForm({ ...form, name: '', businessName: '', email: '' });
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not create contractor', 'error');
    } finally {
      setBusy(false);
    }
  };

  const items = data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Contractors"
        subtitle="1099 collaborators — invoices flow through approval into simulated ACH"
        action={
          canWrite ? (
            <Button onClick={() => setOpen(true)}>
              <UserPlus className="h-4 w-4" /> Add contractor
            </Button>
          ) : undefined
        }
      />

      {loading && !data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState title="No contractors yet" icon={<Handshake className="h-5 w-5" />} />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence>
            {items.map((c, i) => (
              <motion.div
                key={c.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i * 0.05, 0.4) } }}
                exit={{ opacity: 0, scale: 0.97 }}
                whileHover={{ y: -3 }}
                transition={easeOut}
                className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-sm font-semibold text-brand-700 ring-1 ring-inset ring-brand-100">
                      {c.name[0]}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{c.name}</p>
                      <p className="text-[11px] text-slate-400">{c.businessName ?? c.email ?? '—'}</p>
                    </div>
                  </div>
                  <Badge tone={c.status === 'ACTIVE' ? 'success' : 'neutral'}>{c.status}</Badge>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-50 pt-3 text-xs">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">Rate</p>
                    <p className="financial font-medium text-slate-700">
                      {c.rateCents ? `${money(c.rateCents)}/${c.rateUnit === 'hourly' ? 'hr' : 'unit'}` : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">Terms</p>
                    <p className="font-medium text-slate-700">{c.paymentTerms}</p>
                  </div>
                </div>
                <a
                  href="/invoices"
                  className="mt-3 inline-block text-xs font-medium text-brand-600 hover:underline"
                >
                  View invoices →
                </a>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <Drawer open={open} onClose={() => setOpen(false)} title="Add contractor" subtitle="Creates an optional portal login too">
        <form onSubmit={create} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Name</label>
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Business name</label>
            <Input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Email</label>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Payment terms</label>
              <Input value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Rate ($/hr)</label>
              <Input
                type="number"
                step="any"
                min={0}
                value={form.rateCents / 100}
                onChange={(e) => setForm({ ...form, rateCents: Math.round(Number(e.target.value) * 100) })}
              />
            </div>
          </div>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Creating…' : 'Create contractor'}
          </Button>
        </form>
      </Drawer>
    </div>
  );
}
