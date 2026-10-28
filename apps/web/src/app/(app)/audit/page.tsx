'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Fingerprint, Lock } from 'lucide-react';
import { useApi, type Paged } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn, dateTime } from '@/lib/format';
import { Badge, Button, Card, EmptyState, Input, Skeleton, Table, Td, Th } from '@/components/ui';
import { PageHeader } from '@/components/drawer';
import { easeOut } from '@/components/motion';

interface AuditEvent {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorEmail?: string | null;
  actor?: { name: string; email: string; role: string } | null;
  beforeState?: unknown;
  afterState?: unknown;
  createdAt: string;
  companyId?: string | null;
}

export default function AuditPage() {
  const { user } = useSession();
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const qs = `?page=${page}&pageSize=25${action ? `&action=${encodeURIComponent(action)}` : ''}${entity ? `&entityType=${encodeURIComponent(entity)}` : ''}`;
  const { data, loading } = useApi<Paged<AuditEvent>>(`/audit${qs}`, { pollMs: 8000 });

  return (
    <div>
      <PageHeader
        title="Activity log"
        subtitle="Append-only audit trail — UPDATE and DELETE are rejected by database triggers, not just hidden routes."
        action={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-white">
            <Lock className="h-3.5 w-3.5 text-brand-400" /> immutable
          </span>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          placeholder="Filter by action (e.g. payroll.run)…"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
          className="w-72"
        />
        <Input
          placeholder="Entity type (e.g. PayrollRun)…"
          value={entity}
          onChange={(e) => {
            setEntity(e.target.value);
            setPage(1);
          }}
          className="w-56"
        />
        <span className="ml-auto text-xs text-slate-400">{data?.total ?? '—'} events</span>
      </div>

      <Card>
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Action</Th>
              <Th>Entity</Th>
              <Th>Actor</Th>
              <Th className="text-right">Detail</Th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {(data?.items ?? []).map((e, i) => (
                <motion.tr
                  key={e.id}
                  layout
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i * 0.015, 0.25) } }}
                  exit={{ opacity: 0 }}
                  transition={easeOut}
                  className="group hover:bg-slate-50/70"
                >
                  <Td className="whitespace-nowrap text-xs text-slate-500">{dateTime(e.createdAt)}</Td>
                  <Td>
                    <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] font-medium text-slate-700">
                      {e.action}
                    </span>
                  </Td>
                  <Td className="text-xs">
                    <span className="text-slate-600">{e.entityType}</span>
                    <span className="ml-1.5 font-mono text-[10px] text-slate-400">{e.entityId.slice(0, 8)}</span>
                  </Td>
                  <Td className="text-xs text-slate-500">{e.actor?.email ?? e.actorEmail ?? 'system'}</Td>
                  <Td className="text-right">
                    <button
                      type="button"
                      onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
                    >
                      payload
                      <motion.span animate={{ rotate: expanded === e.id ? 180 : 0 }} transition={easeOut}>
                        <ChevronDown className="h-3.5 w-3.5" />
                      </motion.span>
                    </button>
                  </Td>
                </motion.tr>
              ))}
            </AnimatePresence>
            {loading &&
              [0, 1, 2].map((i) => (
                <tr key={i}>
                  <Td colSpan={5}>
                    <Skeleton className="h-9" />
                  </Td>
                </tr>
              ))}
          </tbody>
        </Table>

        {/* Expandable payload row (AnimatePresence collapse) */}
        <AnimatePresence>
          {expanded && data?.items.find((x) => x.id === expanded) && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={easeOut}
              className="overflow-hidden border-t border-slate-100 bg-slate-50/70"
            >
              {(() => {
                const e = data.items.find((x) => x.id === expanded)!;
                return (
                  <div className="grid gap-4 px-5 py-4 md:grid-cols-2">
                    <div>
                      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        <Fingerprint className="h-3.5 w-3.5" /> before
                      </p>
                      <pre className="max-h-48 overflow-auto rounded-lg bg-white p-3 text-[11px] leading-relaxed text-slate-600 ring-1 ring-inset ring-slate-200">
                        {e.beforeState ? JSON.stringify(e.beforeState, null, 2) : '∅'}
                      </pre>
                    </div>
                    <div>
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">after</p>
                      <pre className="max-h-48 overflow-auto rounded-lg bg-white p-3 text-[11px] leading-relaxed text-slate-600 ring-1 ring-inset ring-slate-200">
                        {e.afterState ? JSON.stringify(e.afterState, null, 2) : '∅'}
                      </pre>
                    </div>
                  </div>
                );
              })()}
            </motion.div>
          )}
        </AnimatePresence>

        {!loading && (data?.items ?? []).length === 0 && (
          <EmptyState title="No audit events match" hint="Clear filters, or perform an action to generate trail entries." />
        )}

        {(data?.totalPages ?? 1) > 1 && (
          <div className="flex items-center justify-between px-5 py-3 text-xs text-slate-500">
            <span>
              Page {data?.page} of {data?.totalPages}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="secondary" size="sm" disabled={page >= (data?.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      <p className={cn('mt-4 flex items-center gap-1.5 text-[11px] text-slate-400')}>
        Viewing as {user?.role?.replace('_', ' ').toLowerCase()} · tenant-scoped by JWT
      </p>
    </div>
  );
}
