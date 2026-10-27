import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/app/providers';
import { AuthProvider } from '@/components/app/auth-context';
import { ThemeProvider, THEME_BOOT_SCRIPT } from '@/components/theme/theme';

/*
 * Three faces from two families, each with one job.
 *
 * Plus Jakarta Sans sets headings only — page titles, panel titles — where
 * its open geometry gives the page a voice. Geist sets everything you read
 * and operate: navigation, labels, body, and every number, with tabular
 * figures so quantities line up down a column. Geist Mono sets SKUs, lot
 * codes and barcodes, where each character must be unambiguous. All three
 * are variable fonts, so weights like 650 are real, not synthesised.
 */
const display = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-display-face',
  display: 'swap',
});

const body = Geist({
  subsets: ['latin'],
  variable: '--font-body-face',
  display: 'swap',
});

const mono = Geist_Mono({
  subsets: ['latin'],
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
    // suppressHydrationWarning on <html>: the pre-paint script sets data-theme
    // before React hydrates, which is the point, not a mismatch.
    <html
      lang="en-IN"
      data-theme="night"
      suppressHydrationWarning
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <head>
        {/* Sets the theme before first paint, so the page never flashes. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      {/*
        suppressHydrationWarning on <body> only.

        Browser extensions (Grammarly, password managers, translators) inject
        attributes onto <body> before React hydrates, which React reports as a
        mismatch the application cannot fix. Scoped to this one element so a
        genuine hydration bug anywhere inside the tree still surfaces.
      */}
      <body suppressHydrationWarning>
        <ThemeProvider>
          <Providers>
            <AuthProvider>{children}</AuthProvider>
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
