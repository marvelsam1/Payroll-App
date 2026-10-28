'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ArrowRight, LockKeyhole, Wallet } from 'lucide-react';
import { useSession } from '@/lib/session';
import { Button, Input, toast } from '@/components/ui';
import { spring, easeOut } from '@/components/motion';
import { cn } from '@/lib/format';

const DEMO = [
  { email: 'admin@northwind.test', label: 'Company Admin' },
  { email: 'accountant@northwind.test', label: 'Accountant' },
  { email: 'hr@northwind.test', label: 'HR Manager' },
  { email: 'ava.chen0@northwind.test', label: 'Employee' },
  { email: 'contractor@northwind.test', label: 'Contractor' },
];

export default function LoginPage() {
  const { login } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState('admin@northwind.test');
  const [password, setPassword] = useState('Password123!');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reduced = useReducedMotion();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      toast('Welcome to PayLedger (simulation)');
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-[calc(100vh_-_2.25rem)] lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-slate-900 lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(16,185,129,0.28),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(14,165,233,0.18),transparent_55%)]" />
        <motion.div
          className="relative flex h-full flex-col justify-between p-12"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...easeOut, duration: 0.5 }}
        >
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 shadow-lg shadow-brand-500/30">
              <Wallet className="h-5 w-5 text-white" />
            </span>
            <span className="text-xl font-semibold tracking-tight text-white">PayLedger</span>
          </div>
          <div>
            <motion.h1
              className="max-w-md text-4xl font-semibold leading-tight tracking-tight text-white"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: 0.08 }}
            >
              Payroll operations with{' '}
              <span className="text-brand-400">audit-grade</span> double-entry accounting.
            </motion.h1>
            <motion.p
              className="mt-4 max-w-md text-sm leading-relaxed text-slate-400"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: 0.16 }}
            >
              2024 tax engine, immutable ledger, simulated ACH rails, compliance mockups —
              architecturally realistic, explicitly simulated.
            </motion.p>
            <motion.ul
              className="mt-8 space-y-2.5 text-sm text-slate-300"
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.25 } } }}
            >
              {[
                'Double-entry ledger — corrections only via reversals',
                'ACH state machine with R01/R02/R03 returns + chaos mode',
                'RBAC enforced at the API across six roles',
              ].map((line) => (
                <motion.li
                  key={line}
                  variants={{ hidden: { opacity: 0, x: -8 }, show: { opacity: 1, x: 0 } }}
                  className="flex items-center gap-2.5"
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-500/15 text-[10px] text-brand-400 ring-1 ring-brand-500/30">
                    ✓
                  </span>
                  {line}
                </motion.li>
              ))}
            </motion.ul>
          </div>
          <p className="text-xs text-slate-500">
            Portfolio demo · No real banking · No real tax filing
          </p>
        </motion.div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center px-5 py-12">
        <motion.div
          className="w-full max-w-sm"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.05 }}
        >
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-white">
              <Wallet className="h-4.5 w-4.5" size={18} />
            </span>
            <span className="text-lg font-semibold tracking-tight">PayLedger</span>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">
            Demo workspace · all passwords are <span className="font-medium">Password123!</span>
          </p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600" htmlFor="email">
                Email
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.test"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600" htmlFor="password">
                Password
              </label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            <AnimatePresence>
              {error && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700"
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>

            <Button type="submit" disabled={busy} className="w-full" size="lg">
              {busy ? 'Signing in…' : 'Sign in to demo'}
              {!busy && <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>

          <div className="mt-7 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              <LockKeyhole className="h-3.5 w-3.5 text-brand-500" />
              One-click demo roles
            </p>
            <div className="grid grid-cols-1 gap-1.5">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  onClick={() => {
                    setEmail(d.email);
                    setPassword('Password123!');
                  }}
                  className={cn(
                    'flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 text-left transition-colors hover:border-brand-200 hover:bg-brand-50',
                  )}
                >
                  <span className="text-xs font-medium text-slate-700">{d.label}</span>
                  <span className="text-[10px] text-slate-400">{d.email}</span>
                </button>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
