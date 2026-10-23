import type { Metadata, Viewport } from 'next';
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/app/providers';
import { AuthProvider } from '@/components/app/auth-context';

/*
 * Three faces, three jobs.
 *
 * Archivo is an industrial grotesque with numerals that hold their shape at
 * display sizes - it carries the figures on the production line and nothing
 * else. IBM Plex Sans was drawn for dense technical interfaces at small sizes,
 * which is what eight hours of data tables actually is. Plex Mono takes SKUs,
 * GRN numbers and quantities, where a column has to line up to be read.
 */
const display = Archivo({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-display-face',
  display: 'swap',
});

const body = IBM_Plex_Sans({
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
