'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

/** Standard easing: springy but confident — used across the whole app. */
export const spring = { type: 'spring', stiffness: 320, damping: 30, mass: 0.8 } as const;
export const easeOut = { duration: 0.28, ease: [0.22, 1, 0.36, 1] } as const;

/**
 * Page-level crossfade used by app/template.tsx — every navigation
 * fades/slides through (honours prefers-reduced-motion).
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10, filter: 'blur(4px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={reduced ? { duration: 0.15 } : { ...easeOut, duration: 0.34 }}
    >
      {children}
    </motion.div>
  );
}

/** Scroll/fade entrance for cards and sections. */
export function FadeIn({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ ...easeOut, delay }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Staggered list — the standard entrance for tables, activity feeds and
 * grouped cards. Children should be direct elements.
 */
export function Stagger({
  children,
  className,
  gap = 0.045,
}: {
  children: ReactNode;
  className?: string;
  gap?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: reduced ? 0 : gap } },
      }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      variants={{
        hidden: reduced ? { opacity: 0 } : { opacity: 0, y: 10 },
        show: { opacity: 1, y: 0, transition: easeOut },
      }}
    >
      {children}
    </motion.div>
  );
}

/** Shared hover lift for cards (4px grid friendly). */
export const cardHover = {
  whileHover: { y: -2, transition: { type: 'spring', stiffness: 400, damping: 28 } },
};

export { motion, useReducedMotion };
