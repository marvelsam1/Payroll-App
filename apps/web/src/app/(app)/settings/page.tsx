'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CloudLightning, ShieldCheck, User2 } from 'lucide-react';
import { api, useApi } from '@/lib/api';
import { useSession } from '@/lib/session';
import { ROLE_LABEL } from '@/lib/nav';
import { Badge, Button, Card, CardHeader, Input, Skeleton, toast } from '@/components/ui';
import { PageHeader } from '@/components/drawer';
import { easeOut } from '@/components/motion';

interface Company {
  id: string;
  name: string;
  ein: string;
  paySchedule: string;
  defaultState: string;
  monthlyRevenueCents: number;
  chaosMode: boolean;
}

export default function SettingsPage() {
  const { user, ready } = useSession();
  const isTenant = user && user.role !== 'PLATFORM_ADMIN';
  const { data: company, loading, refresh } = useApi<Company>(ready && isTenant ? '/companies/me' : null);

  const [revenue, setRevenue] = useState(0);
  const [busy, setBusy] = useState(false);
  const [chaosBusy, setChaosBusy] = useState(false);

  useEffect(() => {
    if (company) setRevenue(company.monthlyRevenueCents);
  }, [company]);

  const saveRevenue = async () => {
    setBusy(true);
    try {
      await api('/companies/me', { method: 'PATCH', json: { monthlyRevenueCents: Number(revenue) } });
      toast('Revenue assumption saved — labor % recalculates');
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleChaos = async () => {
    if (!company) return;
    setChaosBusy(true);
    try {
      await api('/companies/me/chaos-mode', { method: 'POST', json: { enabled: !company.chaosMode } });
      toast(company.chaosMode ? 'Chaos mode disabled' : 'Chaos mode ENABLED — expect R01/R02/R03 returns', company.chaosMode ? 'success' : 'error');
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Toggle failed', 'error');
    } finally {
      setChaosBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Settings" subtitle="Tenant profile, simulation controls and your account" />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Account */}
        <Card>
          <CardHeader title="Your account" />
          <div className="space-y-4 p-5">
            <div className="flex items-center gap-3.5">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-lg font-semibold text-white shadow-sm">
                <User2 className="h-6 w-6" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-800">{user?.name ?? user?.email ?? '—'}</p>
                <p className="text-xs text-slate-500">{user?.email}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="brand">{user ? ROLE_LABEL[user.role] : '—'}</Badge>
              <Badge tone="neutral">tenant: {user?.companyId ? 'scoped' : 'global'}</Badge>
            </div>
            <p className="rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
              RBAC is enforced at the API on every route — the sidebar simply hides what your role cannot call.
            </p>
          </div>
        </Card>

        {/* Company */}
        <Card>
          <CardHeader title="Company profile" subtitle={loading ? '' : company?.name} />
          {loading && !company ? (
            <div className="space-y-3 p-5">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : !company ? (
            <p className="p-5 text-xs text-slate-400">Platform admins don&apos;t own a tenant profile.</p>
          ) : (
            <div className="space-y-4 p-5">
              <div className="grid grid-cols-2 gap-3 text-xs">
                {[
                  ['EIN', company.ein],
                  ['Pay schedule', company.paySchedule.toLowerCase()],
                  ['Default state', company.defaultState],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-slate-50 px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">{k}</p>
                    <p className="mt-0.5 font-medium text-slate-700">{v}</p>
                  </div>
                ))}
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Monthly revenue ($)</label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min={0}
                    value={revenue / 100}
                    onChange={(e) => setRevenue(Math.round(Number(e.target.value) * 100))}
                  />
                  <Button variant="secondary" onClick={saveRevenue} disabled={busy}>
                    {busy ? 'Saving…' : 'Save'}
                  </Button>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-400">
                  Drives the “labor cost %” KPI — manual input, clearly labeled.
                </p>
              </div>
            </div>
          )}
        </Card>

        {/* Chaos mode */}
        <Card className="lg:col-span-2 border-amber-200">
          <CardHeader
            title={
              <span className="inline-flex items-center gap-2">
                <CloudLightning className="h-4 w-4 text-amber-500" /> ACH chaos mode
              </span>
            }
            subtitle="Injects deterministic classic return codes (R01/R02/R03) into settlement — failed transfers are retriable and fully journaled."
          />
          <div className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="flex items-center gap-3">
              <motion.span
                layout
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                  company?.chaosMode ? 'bg-amber-400' : 'bg-slate-200'
                }`}
              >
                <motion.span
                  layout
                  transition={easeOut}
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ${company?.chaosMode ? 'translate-x-6' : 'translate-x-1'}`}
                />
              </motion.span>
              <span className="text-sm font-medium text-slate-700">
                {company?.chaosMode ? 'ON — settlements may fail' : 'OFF — nominal settlement'}
              </span>
            </div>
            <Button variant={company?.chaosMode ? 'secondary' : 'primary'} onClick={toggleChaos} disabled={!company || chaosBusy}>
              {chaosBusy ? 'Toggling…' : company?.chaosMode ? 'Turn off' : 'Enable chaos'}
            </Button>
          </div>
        </Card>

        {/* About */}
        <Card className="lg:col-span-2">
          <CardHeader
            title={
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-brand-500" /> About this simulation
              </span>
            }
          />
          <div className="grid gap-3 p-5 text-xs leading-relaxed text-slate-500 md:grid-cols-3">
            <p className="rounded-lg bg-slate-50 p-3.5">
              <strong className="text-slate-700">No real money.</strong> ACH rails, bank accounts and
              settlement windows are simulated state machines — nothing touches the banking system.
            </p>
            <p className="rounded-lg bg-slate-50 p-3.5">
              <strong className="text-slate-700">No real filings.</strong> 941 / W-2 / SUTA PDFs are
              watermarked “SIMULATED — NOT FOR FILING” and never transmitted anywhere.
            </p>
            <p className="rounded-lg bg-slate-50 p-3.5">
              <strong className="text-slate-700">Real engineering.</strong> Double-entry ledger with DB
              triggers, 2024 tax engine, multi-tenancy and RBAC are production-shaped — verified by tests.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
