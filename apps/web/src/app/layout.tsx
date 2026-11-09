import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { LocaleSync } from '@/components/LocaleSync';
import './globals.css';

export const metadata: Metadata = {
  title: 'BoloKhata',
  description: 'Bolkar bill banao: realtime Hinglish voice billing for kirana stores.', // i18n-ignore: static build-time metadata, not on-screen UI
  applicationName: 'BoloKhata',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'BoloKhata', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#f2f2f6' }, { media: '(prefers-color-scheme: dark)', color: '#000000' }],
};

/** The shell shared by the landing page and the app. Login, local data and the nav live in `(app)/layout.tsx`. */
export default function RootLayout({ children }: { children: ReactNode }) {
  // `lang` is set on the client to the chosen language before first paint (LocaleSync).
  return (
    <html lang="hi-Latn" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <LocaleSync />
        {children}
      </body>
    </html>
  );
}
