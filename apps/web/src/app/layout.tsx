import type { Metadata } from 'next';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@/styles/globals.css';
import { SessionProvider } from '@/lib/session';
import { SimulationBanner } from '@/components/banner';
import { Toaster } from '@/components/ui';

export const metadata: Metadata = {
  title: 'PayLedger — Simulated Payroll',
  description:
    'Simulated fintech platform for portfolio demonstration. No real money is moved and no real tax filings occur.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans text-foreground">
        {/* Persistent, non-dismissible simulation banner (product requirement) */}
        <div className="sticky top-0 z-[60]">
          <SimulationBanner />
        </div>
        <SessionProvider>
          <Toaster />
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
