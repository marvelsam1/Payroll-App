'use client';

import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { AnimatePresence, motion } from 'framer-motion';
import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/session';
import { navFor } from '@/lib/nav';
import { spring, easeOut } from './motion';

/** ⌘K / Ctrl-K command palette (cmdk) — navigation + quick actions. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const { user, logout } = useSession();
  const router = useRouter();
  const items = navFor(user?.role);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-start justify-center bg-slate-900/40 px-4 pt-[14vh] backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={spring}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
          >
            <Command loop>
              <div className="flex items-center gap-2 border-b border-slate-100 px-4">
                <Search className="h-4 w-4 text-slate-400" />
                <Command.Input
                  placeholder="Jump to a page…"
                  className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
                />
                <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500">
                  esc
                </kbd>
              </div>
              <Command.List className="max-h-72 overflow-y-auto p-2">
                <Command.Empty className="px-3 py-6 text-center text-xs text-slate-500">
                  No matches
                </Command.Empty>
                <Command.Group heading="Navigate" className="space-y-0.5">
                  {items.map((item) => (
                    <Command.Item
                      key={item.href}
                      value={item.label}
                      onSelect={() => go(item.href)}
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-700 data-[selected=true]:bg-brand-50 data-[selected=true]:text-brand-700"
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </Command.Item>
                  ))}
                </Command.Group>
                <Command.Group heading="Actions" className="mt-2 border-t border-slate-100 pt-2">
                  <Command.Item
                    value="sign out"
                    onSelect={() => {
                      setOpen(false);
                      logout();
                    }}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-rose-600 data-[selected=true]:bg-rose-50"
                  >
                    Sign out
                  </Command.Item>
                </Command.Group>
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Small hint chip shown in the topbar. */
export function CommandHint() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
      className="hidden items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500 transition-colors hover:bg-slate-50 md:flex"
    >
      <Search className="h-3.5 w-3.5" />
      Search…
      <kbd className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[10px]">⌘K</kbd>
    </button>
  );
}

export { easeOut };
