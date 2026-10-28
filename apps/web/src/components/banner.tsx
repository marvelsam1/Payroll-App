'use client';

import { motion } from 'framer-motion';

/**
 * Persistent, non-dismissible simulation banner — required by the product
 * spec and visible on every screen (including login).
 */
export function SimulationBanner() {
  return (
    <motion.div
      className="sim-banner relative z-50 flex h-9 items-center justify-center gap-2 px-4 text-center text-[12px] font-medium text-emerald-50"
      initial={{ y: -36 }}
      animate={{ y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
    >
      <span className="hidden shrink-0 items-center gap-1.5 sm:inline-flex">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
        </span>
        SIMULATION
      </span>
      <span className="truncate">
        Simulated fintech platform for portfolio demonstration. No real money is moved and no real tax
        filings occur.
      </span>
    </motion.div>
  );
}
