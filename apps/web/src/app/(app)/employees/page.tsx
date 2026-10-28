'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, UserPlus } from 'lucide-react';
import { api, useApi, type Paged } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn, money } from '@/lib/format';
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
import { Stagger, StaggerItem, easeOut } from '@/components/motion';

interface Employee {
  id: string;
  name: string;
  email?: string | null;
  workState: string;
  residenceState: string;
  payType: string;
  payRateCents: number;
  status: string;
  ptoBalanceDays: number;
  department?: { id: string; name: string } | null;
}

interface Department {
  id: string;
  name: string;
}

export default function EmployeesPage() {
  const { user } = useSession();
  const canWrite = user && ['COMPANY_ADMIN', 'HR_MANAGER', 'PLATFORM_ADMIN'].includes(user.role);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const { data, loading, refresh } = useApi<Paged<Employee>>(
    `/employees?page=1&pageSize=100${search ? `&search=${encodeURIComponent(search)}` : ''}${status ? `&status=${status}` : ''}`,
  );
  const { data: depts } = useApi<Paged<Department>>('/departments?pageSize=100');

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    ssn: '',
    workState: 'CA',
    residenceState: 'CA',
    payType: 'SALARIED',
    payRateCents: 7_000_000,
    departmentId: '',
    filingStatus: 'SINGLE',
  });

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/employees', {
        method: 'POST',
        json: {
          ...form,
          payRateCents: Number(form.payRateCents),
          departmentId: form.departmentId || undefined,
        },
      });
      toast(`${form.name} added to the roster`);
      setOpen(false);
      setForm({ ...form, name: '', email: '', ssn: '' });
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not create employee', 'error');
    } finally {
      setBusy(false);
    }
  };

  const items = data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle={`${data?.total ?? '—'} people · SSN encrypted at rest · every query scoped to your tenant`}
        action={
          canWrite ? (
            <Button onClick={() => setOpen(true)}>
              <UserPlus className="h-4 w-4" /> Add employee
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Search name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 pl-8"
          />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-36">
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="ON_LEAVE">On leave</option>
          <option value="TERMINATED">Terminated</option>
        </Select>
      </div>

      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Department</Th>
              <Th>Work / residence</Th>
              <Th>Compensation</Th>
              <Th className="text-right">PTO</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {items.map((emp, i) => (
                <motion.tr
                  key={emp.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i * 0.015, 0.3) } }}
                  exit={{ opacity: 0 }}
                  transition={easeOut}
                  className="hover:bg-slate-50/70"
                >
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
                        {emp.name[0]}
                      </span>
                      <div>
                        <p className="font-medium text-slate-800">{emp.name}</p>
                        <p className="text-[11px] text-slate-400">{emp.email ?? '—'}</p>
                      </div>
                    </div>
                  </Td>
                  <Td className="text-xs">{emp.department?.name ?? '—'}</Td>
                  <Td className="text-xs">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">{emp.workState}</span>
                    <span className="mx-1 text-slate-300">→</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">{emp.residenceState}</span>
                  </Td>
                  <Td className="financial text-xs">
                    {emp.payType === 'HOURLY'
                      ? `${money(emp.payRateCents)}/hr`
                      : `${money(emp.payRateCents)} / yr`}
                  </Td>
                  <Td className="text-right financial text-xs">{emp.ptoBalanceDays}</Td>
                  <Td>
                    <Badge layoutId={`emp-${emp.id}`} tone={statusTone(emp.status)}>
                      {emp.status.replace('_', ' ')}
                    </Badge>
                  </Td>
                </motion.tr>
              ))}
            </AnimatePresence>
            {loading &&
              [0, 1, 2, 3, 4].map((i) => (
                <tr key={i}>
                  <Td colSpan={6}>
                    <Skeleton className="h-9" />
                  </Td>
                </tr>
              ))}
          </tbody>
        </Table>
        {!loading && items.length === 0 && (
          <EmptyState title="No employees found" hint="Adjust filters or add someone new." icon={<Plus className="h-5 w-5" />} />
        )}
      </Card>

      <Drawer open={open} onClose={() => setOpen(false)} title="Add employee" subtitle="Drives payroll previews and tax engine inputs">
        <form onSubmit={create} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Full name</label>
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Email</label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">SSN (encrypted)</label>
              <Input
                required
                minLength={9}
                maxLength={11}
                placeholder="123-45-6789"
                value={form.ssn}
                onChange={(e) => setForm({ ...form, ssn: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Work state</label>
              <Select value={form.workState} onChange={(e) => setForm({ ...form, workState: e.target.value })}>
                {['CA', 'TX', 'NY', 'NJ', 'PA'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Residence state</label>
              <Select value={form.residenceState} onChange={(e) => setForm({ ...form, residenceState: e.target.value })}>
                {['CA', 'TX', 'NY', 'NJ', 'PA'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Pay type</label>
              <Select value={form.payType} onChange={(e) => setForm({ ...form, payType: e.target.value })}>
                <option value="SALARIED">Salaried (annual)</option>
                <option value="HOURLY">Hourly</option>
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">
                {form.payType === 'HOURLY' ? 'Hourly rate ($)' : 'Annual salary ($)'}
              </label>
              <Input
                type="number"
                min={form.payType === 'HOURLY' ? 1 : 1000}
                step="any"
                required
                value={form.payRateCents / 100}
                onChange={(e) =>
                  setForm({ ...form, payRateCents: Math.round(Number(e.target.value) * 100) })
                }
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Filing status</label>
              <Select value={form.filingStatus} onChange={(e) => setForm({ ...form, filingStatus: e.target.value })}>
                <option value="SINGLE">Single</option>
                <option value="MARRIED_JOINTLY">Married filing jointly</option>
                <option value="HEAD_OF_HOUSEHOLD">Head of household</option>
              </Select>
            </div>
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
          </div>

          <div className="rounded-xl bg-slate-50 p-3.5 text-[11px] leading-relaxed text-slate-500">
            Tax withholding is computed by the 2024 engine on every payroll preview —{' '}
            {form.workState !== form.residenceState
              ? `cross-state work (${form.workState}) / residence (${form.residenceState}) will surface jurisdiction notes.`
              : 'same-state work and residence keeps withholding simple.'}
          </div>

          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Creating…' : 'Create employee'}
          </Button>
        </form>
      </Drawer>
    </div>
  );
}
