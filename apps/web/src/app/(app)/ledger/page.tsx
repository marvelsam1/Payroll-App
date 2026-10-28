'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeftRight, BadgeCheck, ShieldCheck, Undo2 } from 'lucide-react';
import { api, useApi, type Paged } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn, dateTime, money, moneyShort } from '@/lib/format';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  Select,
  Skeleton,
  Table,
  Td,
  Th,
  toast,
} from '@/components/ui';
import { PageHeader } from '@/components/drawer';
import { Stagger, StaggerItem, easeOut } from '@/components/motion';

interface Account {
  id: string;
  code: string;
  accountName: string;
  accountType: string;
  normalSide: 'DEBIT' | 'CREDIT';
  balanceCents: number;
  debitTotalCents: number;
  creditTotalCents: number;
}

interface Entry {
  id: string;
  debitAmount: number;
  creditAmount: number;
  account: { code: string; accountName: string };
  transaction: {
    id: string;
    date: string;
    description: string;
    referenceType?: string | null;
    reversalOfId?: string | null;
  };
}

interface TrialBalance {
  accounts: Account[];
  totals: { debitCents: number; creditCents: number };
  balanced: boolean;
}

interface ValidateResult {
  ok: boolean;
  checkedAt: string;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
}

export default function LedgerPage() {
  const { user } = useSession();
  const canReverse = user && ['COMPANY_ADMIN', 'PLATFORM_ADMIN'].includes(user.role);

  const [search, setSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [page, setPage] = useState(1);
  const { data: tb, loading: tbLoading } = useApi<TrialBalance>('/ledger/trial-balance');
  const { data: entries, loading, refresh } = useApi<Paged<Entry>>(
    `/ledger/entries?page=${page}&pageSize=25${search ? `&search=${encodeURIComponent(search)}` : ''}${accountFilter ? `&accountId=${accountFilter}` : ''}`,
  );
  const { data: validation, refresh: revalidate } = useApi<ValidateResult>('/ledger/validate', { pollMs: 15000 });

  const [checking, setChecking] = useState(false);
  const [reverseTarget, setReverseTarget] = useState<Entry | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [busy, setBusy] = useState(false);

  const accountsById = useMemo(() => {
    const map = new Map<string, Account>();
    tb?.accounts.forEach((a) => map.set(a.id, a));
    return map;
  }, [tb]);

  const runValidation = async () => {
    setChecking(true);
    try {
      await api('/ledger/validate', { method: 'GET' } as RequestInit);
      await revalidate();
      toast('Invariants validated');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Validation failed', 'error');
    } finally {
      setChecking(false);
    }
  };

  const submitReverse = async () => {
    if (!reverseTarget) return;
    setBusy(true);
    try {
      await api(`/ledger/transactions/${reverseTarget.transaction.id}/reverse`, {
        method: 'POST',
        json: { reason: reverseReason },
      });
      toast('Reversing entries posted (originals stay immutable)');
      setReverseTarget(null);
      setReverseReason('');
      refresh();
      revalidate();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Reversal failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="General ledger"
        subtitle="Double-entry, append-only — corrections happen exclusively via reversing entries."
        action={
          <Button variant="secondary" onClick={runValidation} disabled={checking}>
            <ShieldCheck className="h-4 w-4" /> {checking ? 'Validating…' : 'Validate invariants'}
          </Button>
        }
      />

      {/* Invariant checks */}
      <Card className="mb-5 p-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className={cn('inline-flex items-center gap-1.5 text-sm font-semibold', validation?.ok ? 'text-emerald-600' : 'text-rose-600')}>
            <BadgeCheck className="h-4 w-4" /> {validation ? (validation.ok ? 'All invariants hold' : 'Invariant violation') : 'Checking…'}
          </span>
          {(validation?.checks ?? []).map((c) => (
            <span
              key={c.name}
              className={cn(
                'rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset',
                c.ok ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-rose-200',
              )}
              title={c.detail}
            >
              {c.name.replace(/_/g, ' ')} · {c.detail}
            </span>
          ))}
        </div>
      </Card>

      {/* Trial balance */}
      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Trial balance" subtitle="Natural-side balances per account" />
          <Stagger className="grid grid-cols-2 gap-px bg-slate-100 md:grid-cols-3">
            {(tb?.accounts ?? []).map((a) => (
              <StaggerItem key={a.id}>
                <div className="h-full bg-white px-4 py-3">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{a.code}</p>
                  <p className="financial mt-1 text-sm font-semibold text-slate-800">{money(a.balanceCents)}</p>
                  <p className="text-[10px] text-slate-400">
                    {a.accountType} · {a.normalSide.toLowerCase()}
                  </p>
                </div>
              </StaggerItem>
            ))}
            {tbLoading && [0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="m-2 h-16" />)}
          </Stagger>
        </Card>

        <Card className="p-5">
          <p className="text-sm font-semibold text-slate-800">Control totals</p>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Total debits</span>
              <span className="financial font-semibold text-slate-800">{money(tb?.totals.debitCents ?? 0)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Total credits</span>
              <span className="financial font-semibold text-slate-800">{money(tb?.totals.creditCents ?? 0)}</span>
            </div>
            <div className="border-t border-slate-100 pt-3">
              <Badge tone={tb?.balanced ? 'success' : 'danger'} layoutId="tb-balanced">
                {tb?.balanced ? 'BALANCED' : 'OUT OF BALANCE'}
              </Badge>
            </div>
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
            Balances are always derived with groupBy aggregates — no cached balance field can drift.
          </p>
        </Card>
      </div>

      {/* Entries viewer */}
      <Card>
        <CardHeader
          title="Entries"
          subtitle="Every posting, newest first"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="Search description…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="h-8 w-44 text-xs"
              />
              <Select
                value={accountFilter}
                onChange={(e) => {
                  setAccountFilter(e.target.value);
                  setPage(1);
                }}
                className="h-8 w-40 text-xs"
              >
                <option value="">All accounts</option>
                {(tb?.accounts ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code}
                  </option>
                ))}
              </Select>
            </div>
          }
        />
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Description</Th>
              <Th>Account</Th>
              <Th className="text-right">Debit</Th>
              <Th className="text-right">Credit</Th>
              <Th className="text-right">Ref</Th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {(entries?.items ?? []).map((e) => (
                <motion.tr
                  key={e.id}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={easeOut}
                  className="group hover:bg-slate-50/70"
                >
                  <Td className="whitespace-nowrap text-xs">{dateTime(e.transaction.date)}</Td>
                  <Td>
                    <span className="text-slate-700">{e.transaction.description}</span>
                    {e.transaction.reversalOfId && (
                      <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                        reversal
                      </span>
                    )}
                  </Td>
                  <Td className="text-xs font-medium text-slate-500">{e.account.code}</Td>
                  <Td className="text-right financial">{e.debitAmount ? money(e.debitAmount) : '—'}</Td>
                  <Td className="text-right financial">{e.creditAmount ? money(e.creditAmount) : '—'}</Td>
                  <Td className="text-right">
                    <span className="text-[10px] text-slate-400">{e.transaction.referenceType ?? 'manual'}</span>
                    {canReverse && !e.transaction.reversalOfId && e.transaction.referenceType !== 'opening_balance' && (
                      <button
                        type="button"
                        title="Post reversing entries"
                        onClick={() => setReverseTarget(e)}
                        className="ml-2 hidden rounded p-1 text-slate-400 hover:bg-white hover:text-rose-500 group-hover:inline-block"
                      >
                        <Undo2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </Td>
                </motion.tr>
              ))}
            </AnimatePresence>
            {loading && [0, 1, 2].map((i) => (
              <tr key={i}>
                <Td colSpan={6}>
                  <Skeleton className="h-8" />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {!loading && (entries?.items ?? []).length === 0 && (
          <EmptyState title="No entries match" hint="Post payroll or approve an invoice to see journal activity." />
        )}
        {(entries?.totalPages ?? 1) > 1 && (
          <div className="flex items-center justify-between px-5 py-3 text-xs text-slate-500">
            <span>
              Page {entries?.page} of {entries?.totalPages} · {entries?.total} entries
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="secondary" size="sm" disabled={page >= (entries?.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Reversal dialog */}
      <AnimatePresence>
        {reverseTarget && (
          <motion.div
            className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-900/40 px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setReverseTarget(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 340, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl"
            >
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ArrowLeftRight className="h-4 w-4 text-rose-500" /> Post reversing entries
              </p>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                The original transaction <span className="font-mono">{reverseTarget.transaction.id.slice(0, 8)}</span> stays
                immutable — a mirrored transaction will be appended and cross-linked in both directions.
              </p>
              <Input
                className="mt-4"
                placeholder="Reason (recorded in the audit trail)"
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
              />
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setReverseTarget(null)}>
                  Cancel
                </Button>
                <Button variant="danger" disabled={!reverseReason.trim() || busy} onClick={submitReverse}>
                  {busy ? 'Posting…' : 'Post reversal'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
