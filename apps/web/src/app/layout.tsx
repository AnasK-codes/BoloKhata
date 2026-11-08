import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AppProvider } from '@/components/AppProvider';
import { BottomNav } from '@/components/BottomNav';
import { PwaRegister } from '@/components/PwaRegister';
import { AccountGate } from '@/components/AccountGate';
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

export default function RootLayout({ children }: { children: ReactNode }) {
  // `lang` is set on the client to the chosen language before first paint (LocaleSync).
  return (
    <html lang="hi-Latn" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <LocaleSync />
        <AccountGate><AppProvider>
          <div className="app-content">{children}</div>
          <BottomNav />
          <PwaRegister />
        </AppProvider></AccountGate>
      </body>
    </html>
  );
}
