import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Inter, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/app/providers';
import { AuthProvider } from '@/components/app/auth-context';
import { ThemeProvider, THEME_BOOT_SCRIPT } from '@/components/theme/theme';

/*
 * Three faces, three jobs.
 *
 * Plus Jakarta Sans carries the interface and the headings: open counters and
 * a geometric calm that suits glass, and it holds a 40px figure without
 * looking inflated. Inter sets the numbers — its tabular figures are the most
 * reliable at small sizes, which matters in a column of quantities. Plex Mono
 * takes SKUs and barcodes, where every character must be unambiguous.
 */
const body = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body-face',
  display: 'swap',
});

const numeric = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-numeric-face',
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
    // suppressHydrationWarning on <html>: the pre-paint script sets data-theme
    // before React hydrates, which is the point, not a mismatch.
    <html
      lang="en-IN"
      data-theme="night"
      suppressHydrationWarning
      className={`${body.variable} ${numeric.variable} ${mono.variable}`}
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
