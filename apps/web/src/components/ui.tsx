'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import CountUp from 'react-countup';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { cn, moneyShort } from '@/lib/format';
import { spring, easeOut } from './motion';

// ---------------------------------------------------------------------------
// Card — white, shadow-sm, rounded-xl (design system standard)
// ---------------------------------------------------------------------------

export function Card({
  children,
  className,
  hover = false,
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={cn('rounded-xl border border-slate-200/80 bg-white shadow-sm', className)}
      whileHover={hover && !reduced ? { y: -2 } : undefined}
      transition={spring}
    >
      {children}
    </motion.div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4', className)}>
      <div>
        <h3 className="text-sm font-semibold tracking-tight text-slate-900">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-brand-500 text-white hover:bg-brand-600 shadow-sm',
        secondary: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
        ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        danger: 'bg-rose-500 text-white hover:bg-rose-600',
        soft: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-4',
        lg: 'h-10 px-5',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

// ---------------------------------------------------------------------------
// Badge — layout-animated status pill (standard animation for status change)
// ---------------------------------------------------------------------------

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand';

const toneClass: Record<BadgeTone, string> = {
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200',
  danger: 'bg-rose-50 text-rose-700 ring-rose-200',
  info: 'bg-sky-50 text-sky-700 ring-sky-200',
  neutral: 'bg-slate-100 text-slate-600 ring-slate-200',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
  layoutId,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  layoutId?: string;
}) {
  return (
    <motion.span
      layout={Boolean(layoutId)}
      layoutId={layoutId}
      transition={spring}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        toneClass[tone],
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {children}
    </motion.span>
  );
}

/** Map common API status strings to badge tones. */
export function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'COMPLETED':
    case 'SETTLED':
    case 'PAID':
    case 'APPROVED':
    case 'REIMBURSED':
    case 'ACTIVE':
      return 'success';
    case 'PENDING':
    case 'PENDING_APPROVAL':
    case 'PROCESSING':
    case 'INITIATED':
    case 'SUBMITTED':
    case 'ON_LEAVE':
      return 'warning';
    case 'FAILED':
    case 'REJECTED':
    case 'TERMINATED':
      return 'danger';
    case 'DRAFT':
    case 'REJECTED ':
      return 'neutral';
    default:
      return 'info';
  }
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const fieldCls =
  'h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 transition-shadow';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldCls, className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldCls, 'pr-8', className)} {...props}>
      {children}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'border-b border-slate-100 bg-slate-50/60 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  colSpan,
}: {
  children?: ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={cn('border-b border-slate-100 px-4 py-3 text-slate-700', className)}>
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Skeleton / Empty
// ---------------------------------------------------------------------------

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('shimmer-skeleton rounded-lg', className)} />;
}

export function EmptyState({ title, hint, icon }: { title: string; hint?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
        {icon ?? '∅'}
      </div>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint ? <p className="max-w-sm text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card — countup KPI (standard animation from first implementation)
// ---------------------------------------------------------------------------

export function StatCard({
  label,
  value,
  hint,
  tone = 'brand',
  format = 'money',
  delay = 0,
}: {
  label: string;
  value: number | null | undefined;
  hint?: ReactNode;
  tone?: 'brand' | 'sky' | 'amber' | 'rose' | 'slate';
  format?: 'money' | 'moneyShort' | 'number' | 'percent';
  delay?: number;
}) {
  const toneRing = {
    brand: 'bg-brand-50 text-brand-600',
    sky: 'bg-sky-50 text-sky-600',
    amber: 'bg-amber-50 text-amber-600',
    rose: 'bg-rose-50 text-rose-600',
    slate: 'bg-slate-100 text-slate-600',
  }[tone];

  const render = (v: number) => {
    if (format === 'money' || format === 'moneyShort') return moneyShort(v);
    if (format === 'percent') return `${(v / 10).toFixed(1)}%`; // value in tenths
    return new Intl.NumberFormat('en-US').format(v);
  };

  return (
    <Card hover className="p-5">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...easeOut, delay }}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
          <span className={cn('h-2 w-2 rounded-full', toneRing.split(' ')[0])} />
        </div>
        <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 financial">
          {value == null ? (
            '—'
          ) : (
            <CountUp key={value} end={value} duration={1.4} formattingFn={render} />
          )}
        </p>
        {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      </motion.div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Toasts — spring toasts (standard)
// ---------------------------------------------------------------------------

interface ToastItem {
  id: number;
  message: string;
  tone: 'success' | 'error';
}

let toastListeners: Array<(t: ToastItem) => void> = [];
let toastSeq = 1;

export function toast(message: string, tone: 'success' | 'error' = 'success') {
  const item = { id: toastSeq++, message, tone };
  toastListeners.forEach((l) => l(item));
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const reduced = useReducedMotion();

  useEffect(() => {
    const listener = (t: ToastItem) => {
      setItems((prev) => [...prev, t]);
      window.setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 4200);
    };
    toastListeners.push(listener);
    return () => {
      toastListeners = toastListeners.filter((l) => l !== listener);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-80 flex-col gap-2">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: 60, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: 40, scale: 0.95 }}
            transition={spring}
            className={cn(
              'pointer-events-auto rounded-xl border p-3.5 text-sm shadow-card',
              t.tone === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-rose-200 bg-rose-50 text-rose-800',
            )}
          >
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 text-base leading-none">{t.tone === 'success' ? '✓' : '✕'}</span>
              <span className="leading-snug">{t.message}</span>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

import { useEffect, useState } from 'react';
