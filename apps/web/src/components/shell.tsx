'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { LogOut, Menu, X, Wallet } from 'lucide-react';
import { useSession } from '@/lib/session';
import { navFor, ROLE_LABEL } from '@/lib/nav';
import { cn } from '@/lib/format';
import { CommandHint, CommandPalette } from './command';
import { Toaster } from './ui';
import { spring, easeOut } from './motion';

/**
 * Authenticated app shell: persistent simulation banner, role-filtered
 * sidebar with layout-animated active pill, topbar with command palette.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, ready, logout } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (ready && !user) router.replace('/login');
  }, [ready, user, router]);

  useEffect(() => setMobileOpen(false), [pathname]);

  if (!ready || !user) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-50">
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
            <p className="text-xs text-slate-500">Loading PayLedger…</p>
          </div>
        </div>
      </div>
    );
  }

  const items = navFor(user.role);

  const sidebar = (
    <nav className="flex h-full flex-col">
      <Link href="/dashboard" className="flex items-center gap-2.5 px-5 pb-5 pt-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white shadow-sm">
          <Wallet className="h-4.5 w-4.5" size={18} />
        </span>
        <span>
          <span className="block text-[15px] font-semibold leading-none tracking-tight text-slate-900">
            PayLedger
          </span>
          <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-wider text-brand-600">
            Simulated payroll
          </span>
        </span>
      </Link>

      <div className="flex-1 space-y-0.5 overflow-y-auto px-3">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active ? 'text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
              )}
            >
              {active && (
                <motion.span
                  layoutId="nav-active"
                  className="absolute inset-0 rounded-lg bg-brand-50 ring-1 ring-inset ring-brand-100"
                  transition={spring}
                />
              )}
              <item.icon className={cn('relative h-4 w-4', active ? 'text-brand-600' : 'text-slate-400')} />
              <span className="relative">{item.label}</span>
            </Link>
          );
        })}
      </div>

      <div className="border-t border-slate-100 p-3">
        <div className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
            {user.name?.[0] ?? user.email[0].toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-slate-800">{user.name ?? user.email}</p>
            <p className="truncate text-[10px] text-slate-500">{ROLE_LABEL[user.role]}</p>
          </div>
          <button
            type="button"
            onClick={logout}
            title="Sign out"
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white hover:text-rose-500"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <div className="flex flex-1 overflow-hidden">
        {/* Desktop sidebar */}
        <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white lg:block">{sidebar}</aside>

        {/* Mobile drawer (spring) */}
        <AnimatePresence>
          {mobileOpen && (
            <>
              <motion.div
                className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setMobileOpen(false)}
              />
              <motion.aside
                className="fixed inset-y-0 left-0 z-50 w-64 bg-white shadow-xl lg:hidden"
                initial={reduced ? { opacity: 0 } : { x: -280 }}
                animate={reduced ? { opacity: 1 } : { x: 0 }}
                exit={reduced ? { opacity: 0 } : { x: -280 }}
                transition={spring}
              >
                <button
                  type="button"
                  className="absolute right-3 top-3 rounded-md p-1.5 text-slate-400 hover:bg-slate-100"
                  onClick={() => setMobileOpen(false)}
                >
                  <X className="h-4 w-4" />
                </button>
                {sidebar}
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/85 px-4 backdrop-blur-md md:px-6">
            <button
              type="button"
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="hidden items-center gap-2 text-xs text-slate-500 md:flex">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 animate-pulse-dot rounded-full bg-brand-500" />
                Demo tenant live
              </span>
            </div>
            <div className="ml-auto flex items-center gap-2.5">
              <CommandHint />
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-xs font-semibold text-white shadow-sm"
                title={user.email}
              >
                {(user.name?.[0] ?? user.email[0]).toUpperCase()}
              </span>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto px-4 py-6 md:px-6 lg:px-8">{children}</main>
        </div>
      </div>

      <CommandPalette />
      <Toaster />
    </div>
  );
}

export { easeOut };
