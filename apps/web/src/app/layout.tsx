import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Instrument_Sans, Inter } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/app/providers';
import { AuthProvider } from '@/components/app/auth-context';

/*
 * Three faces, three jobs — and with no colour in the system, type carries
 * almost all of the hierarchy, so the pairing has to do real work.
 *
 * Instrument Sans is a confident, slightly narrow grotesque: it holds a 40px
 * figure without looking inflated and a 12px eyebrow without looking thin,
 * which is the range a monochrome page asks of its display face.
 *
 * Inter takes the interface. At 13px across eight hours it is simply the right
 * tool — a large x-height and real tabular figures matter more here than
 * novelty. Plex Mono takes SKUs and quantities, where a column must line up.
 */
const display = Instrument_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display-face',
  display: 'swap',
});

const body = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-body-face',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono-face',
  display: 'swap',
});

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
    <html lang="en-IN" className={`${display.variable} ${body.variable} ${mono.variable}`}>
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
