'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, CalendarDays, Download, MapPin } from 'lucide-react';
import { getToken } from '@/lib/api';
import { useApi } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn, date } from '@/lib/format';
import { Badge, Button, Card, CardHeader, EmptyState, Skeleton, Table, Td, Th, toast } from '@/components/ui';
import { PageHeader } from '@/components/drawer';
import { Stagger, StaggerItem, easeOut } from '@/components/motion';

interface CalEvent {
  date: string;
  form: '941' | 'W-2' | 'SUTA';
  title: string;
  period: string;
  status: 'upcoming' | 'overdue' | 'simulated_filed';
}

interface Jurisdiction {
  summary: { totalActive: number; crossState: number; reciprocal: number; nonReciprocal: number; nycResidents: number };
  employees: Array<{
    id: string;
    name: string;
    workState: string;
    residenceState: string;
    reciprocal: boolean;
    note: string;
  }>;
}

export default function CompliancePage() {
  const { user } = useSession();
  const canGenerate = user && ['COMPANY_ADMIN', 'PLATFORM_ADMIN'].includes(user.role);
  const year = new Date().getFullYear();
  const { data: calendar, loading } = useApi<CalEvent[]>(`/compliance/calendar?year=${year}`);
  const { data: juris } = useApi<Jurisdiction>('/compliance/jurisdiction-check');
  const { data: states } = useApi<{
    states: Array<{ code: string; type: string }>;
    reciprocalPairs: string[][];
    disclaimer: string;
  }>('/compliance/states');
  const { data: empList } = useApi<Array<{ id: string; name: string; workState: string }>>('/compliance/w2-employees');

  const [w2Emp, setW2Emp] = useState('');

  const download = async (path: string, filename: string) => {
    if (!canGenerate) {
      toast('Your role cannot generate forms (compliance:generate)', 'error');
      return;
    }
    try {
      const res = await fetch(`/api/v1${path}`, {
        headers: { Authorization: `Bearer ${getToken() ?? ''}` },
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast(`${filename} downloaded — watermark: SIMULATED — NOT FOR FILING`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Download failed', 'error');
    }
  };

  const formTone = (s: CalEvent['status']) => (s === 'simulated_filed' ? 'success' : s === 'overdue' ? 'danger' : 'info');

  return (
    <div>
      <PageHeader
        title="Compliance"
        subtitle="Filing calendar, jurisdiction rules and watermarked mockups — nothing is ever filed."
        action={
          <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
            SIMULATED — NOT FOR FILING
          </span>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Filing calendar */}
        <Card className="lg:col-span-2">
          <CardHeader title={`${year} filing calendar`} subtitle="Statutory-ish due dates with simulated filing state" />
          {loading ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : (
            <Stagger className="divide-y divide-slate-50">
              {(calendar ?? []).map((e) => (
                <StaggerItem key={`${e.form}-${e.date}-${e.title}`}>
                  <div className="flex items-center gap-4 px-5 py-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500 ring-1 ring-inset ring-slate-100">
                      <CalendarDays className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{e.title}</p>
                      <p className="text-[11px] text-slate-400">
                        due {date(e.date)} · {e.period}
                      </p>
                    </div>
                    <span className="hidden rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 sm:inline">
                      {e.form}
                    </span>
                    <Badge tone={formTone(e.status)} layoutId={`cal-${e.form}-${e.date}`}>
                      {e.status.replace('_', ' ')}
                    </Badge>
                  </div>
                </StaggerItem>
              ))}
              {(calendar ?? []).length === 0 && <EmptyState title="No filing events" />}
            </Stagger>
          )}
        </Card>

        {/* Form generators */}
        <Card>
          <CardHeader title="Form mockups" subtitle="PDFs populated from real ledger + payroll data" />
          <div className="space-y-3 p-5">
            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
              <p className="text-sm font-semibold text-slate-800">Form 941</p>
              <p className="mt-0.5 text-[11px] text-slate-500">Quarterly federal payroll tax return</p>
              <div className="mt-3 flex gap-2">
                {[1, 2, 3, 4].map((q) => (
                  <Button
                    key={q}
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      const starts = [`${year}-01-01`, `${year}-04-01`, `${year}-07-01`, `${year}-10-01`];
                      const ends = [`${year}-03-31`, `${year}-06-30`, `${year}-09-30`, `${year}-12-31`];
                      void download(
                        `/compliance/forms/941?periodStart=${starts[q - 1]}&periodEnd=${ends[q - 1]}`,
                        `form-941-q${q}-${year}-simulated.pdf`,
                      );
                    }}
                  >
                    Q{q}
                  </Button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
              <p className="text-sm font-semibold text-slate-800">Form W-2</p>
              <p className="mt-0.5 text-[11px] text-slate-500">Per employee, prior-year YTD figures</p>
              <div className="mt-3 flex gap-2">
                <select
                  value={w2Emp}
                  onChange={(e) => setW2Emp(e.target.value)}
                  className="h-8 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-xs"
                >
                  <option value="">Select employee…</option>
                  {(empList ?? []).map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
                <Button size="sm" variant="secondary" disabled={!w2Emp} onClick={() => void download(`/compliance/forms/w2?employeeId=${w2Emp}&year=${year}`, `form-w2-${year}-simulated.pdf`)}>
                  <Download className="h-3.5 w-3.5" /> W-2
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
              <p className="text-sm font-semibold text-slate-800">SUTA report</p>
              <p className="mt-0.5 text-[11px] text-slate-500">State unemployment · $10k wage base · 2.70%</p>
              <div className="mt-3 flex gap-2">
                {[1, 2, 3, 4].map((q) => (
                  <Button key={q} size="sm" variant="secondary" onClick={() => void download(`/compliance/forms/suta?year=${year}&quarter=${q}`, `form-suta-q${q}-${year}-simulated.pdf`)}>
                    Q{q}
                  </Button>
                ))}
              </div>
            </div>

            {!canGenerate && (
              <p className="flex items-start gap-1.5 text-[11px] text-amber-600">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Your role has compliance:read only — form generation requires Company Admin.
              </p>
            )}
          </div>
        </Card>
      </div>

      {/* Jurisdiction check */}
      <Card className="mt-4">
        <CardHeader
          title="Jurisdiction check"
          subtitle={
            juris
              ? `${juris.summary.crossState} cross-state of ${juris.summary.totalActive} active · ${juris.summary.reciprocal} reciprocal · ${juris.summary.nonReciprocal} source-state`
              : 'Work state vs residence state'
          }
          action={
            <span className="hidden items-center gap-1.5 text-xs text-slate-500 sm:inline-flex">
              <MapPin className="h-3.5 w-3.5 text-brand-500" /> NYC residents: {juris?.summary.nycResidents ?? 0}
            </span>
          }
        />
        <Table>
          <thead>
            <tr>
              <Th>Employee</Th>
              <Th>Work state</Th>
              <Th>Residence</Th>
              <Th>Reciprocity</Th>
              <Th>Withholding expectation</Th>
            </tr>
          </thead>
          <tbody>
            {(juris?.employees ?? []).map((e, i) => (
              <motion.tr
                key={e.id}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...easeOut, delay: i * 0.03 }}
                className="hover:bg-slate-50/70"
              >
                <Td className="font-medium text-slate-800">{e.name}</Td>
                <Td>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">{e.workState}</span>
                </Td>
                <Td>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">{e.residenceState}</span>
                </Td>
                <Td>
                  <Badge tone={e.reciprocal ? 'success' : 'neutral'}>{e.reciprocal ? 'reciprocal' : 'none'}</Badge>
                </Td>
                <Td className="text-xs text-slate-500">{e.note}</Td>
              </motion.tr>
            ))}
          </tbody>
        </Table>
        {(juris?.employees ?? []).length === 0 && <EmptyState title="Everyone works where they live" hint="Add a cross-state employee to see jurisdiction rules in action." />}
      </Card>

      {/* State reference */}
      <Card className="mt-4">
        <CardHeader title="Configured state rules" subtitle={states?.disclaimer} />
        <div className="flex flex-wrap gap-2.5 p-5">
          {(states?.states ?? []).map((s) => (
            <motion.span
              key={s.code}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={easeOut}
              className="rounded-lg bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm ring-1 ring-inset ring-slate-200"
            >
              {s.code} <span className="text-slate-400">· {s.type}</span>
            </motion.span>
          ))}
          {(states?.reciprocalPairs ?? []).map((pair) => (
            <span key={pair.join('-')} className={cn('rounded-lg bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-100')}>
              {pair.join(' ↔ ')} reciprocal
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}
