'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
  Pie,
  PieChart,
} from 'recharts';
import { useReducedMotion } from 'framer-motion';
import { money, moneyShort } from '@/lib/format';

const GRID = '#e2e8f0';
const AXIS = '#94a3b8';
const EMERALD = '#10b981';
const EMERALD_DARK = '#059669';
const EMERALD_LIGHT = '#a7f3d0';

export const PIE_COLORS = ['#10b981', '#0ea5e9', '#8b5cf6', '#f59e0b', '#f43f5e', '#64748b'];

function anim(enabled: boolean) {
  return { isAnimationActive: enabled };
}

function TooltipBox({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-card">
      <p className="mb-1 font-medium text-slate-600">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="financial text-slate-800">
          <span className="mr-2 inline-block h-2 w-2 rounded-full align-middle" style={{ background: p.color ?? p.fill }} />
          {p.name}: {typeof p.value === 'number' && Math.abs(p.value) > 1000 ? money(p.value) : p.value}
        </p>
      ))}
    </div>
  );
}

export interface CashPoint {
  date: string;
  netCents: number;
  balanceCents: number;
  projected?: boolean;
}

/** Cash-flow area chart — real daily balances + projected next payroll. */
export function CashflowChart({ data, height = 260 }: { data: CashPoint[]; height?: number }) {
  const reduced = useReducedMotion();
  const rows = data.map((d) => ({
    ...d,
    label: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    balance: d.balanceCents / 100,
    net: d.netCents / 100,
  }));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="cashFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={EMERALD} stopOpacity={0.28} />
              <stop offset="100%" stopColor={EMERALD} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={40} />
          <YAxis tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => moneyShort(v * 100)} width={64} />
          <Tooltip content={<TooltipBox />} />
          <Area
            type="monotone"
            dataKey="balance"
            name="Balance"
            stroke={EMERALD_DARK}
            strokeWidth={2}
            fill="url(#cashFill)"
            dot={false}
            {...anim(!reduced)}
            activeDot={{ r: 4, fill: EMERALD_DARK }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface NamedCents {
  name: string;
  cents: number;
}

/** Horizontal-ish payroll bars by department. */
export function BarsByDept({ data, height = 260 }: { data: NamedCents[]; height?: number }) {
  const reduced = useReducedMotion();
  const rows = data.map((d) => ({ name: d.name, gross: d.cents / 100 }));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => moneyShort(v * 100)} width={56} />
          <Tooltip content={<TooltipBox />} cursor={{ fill: '#f1f5f9' }} />
          <Bar dataKey="gross" name="Gross pay" fill={EMERALD} radius={[6, 6, 0, 0]} maxBarSize={48} {...anim(!reduced)} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface SeriesPoint {
  label: string;
  grossCents: number;
  netCents: number;
  taxesCents: number;
}

/** Employee earnings trend (gross vs net). */
export function EarningsLine({ data, height = 240 }: { data: SeriesPoint[]; height?: number }) {
  const reduced = useReducedMotion();
  const rows = data.map((d) => ({
    ...d,
    gross: d.grossCents / 100,
    net: d.netCents / 100,
    taxes: d.taxesCents / 100,
  }));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => moneyShort(v * 100)} width={56} />
          <Tooltip content={<TooltipBox />} />
          <Line type="monotone" dataKey="gross" name="Gross" stroke={EMERALD} strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 4 }} {...anim(!reduced)} />
          <Line type="monotone" dataKey="net" name="Net" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 4 }} {...anim(!reduced)} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Headcount / expense share donut. */
export function ShareDonut({ data, height = 240 }: { data: NamedCents[]; height?: number }) {
  const reduced = useReducedMotion();
  const rows = data.map((d) => ({ name: d.name, value: Math.round(d.cents / 100) }));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={rows} dataKey="value" nameKey="name" innerRadius={58} outerRadius={86} paddingAngle={3} stroke="none" {...anim(!reduced)}>
            {rows.map((_, i) => (
              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<TooltipBox />} formatter={(v: any) => `$${Number(v).toLocaleString()}`} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
