import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/app/providers';
import { AuthProvider } from '@/components/app/auth-context';

export const metadata: Metadata = {
  title: 'DASH AND DOT Manufacturing ERP',
  description: 'Manufacturing and inventory control for DASH AND DOT',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Shop-floor tablets are handled by the layout, not by letting the user
  // pinch-zoom a data table into uselessness.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      {/*
        suppressHydrationWarning on <body> only.

        Browser extensions (Grammarly, password managers, translators) inject
        attributes onto <body> before React hydrates, which React reports as a
        mismatch the application cannot fix. Scoped to this one element so a
        genuine hydration bug anywhere inside the tree still surfaces.
      */}
      <body suppressHydrationWarning>
        <Providers>
          <AuthProvider>{children}</AuthProvider>
        </Providers>
      </body>
    </html>
  );
}
