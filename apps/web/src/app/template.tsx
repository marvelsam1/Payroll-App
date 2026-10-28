'use client';

import { PageTransition } from '@/components/motion';

/** Route-level crossfade on every navigation (standard animation). */
export default function Template({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
