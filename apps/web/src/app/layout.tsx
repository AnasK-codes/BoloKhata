import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AppProvider } from '@/components/AppProvider';
import { BottomNav } from '@/components/BottomNav';
import { PwaRegister } from '@/components/PwaRegister';
import { AccountGate } from '@/components/AccountGate';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bol-Bill',
  description: 'Bolkar bill banao: realtime Hinglish voice billing for kirana stores.',
  applicationName: 'Bol-Bill',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Bol-Bill', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#f2f2f6' }, { media: '(prefers-color-scheme: dark)', color: '#000000' }],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-dvh antialiased">
        <AccountGate><AppProvider>
          <div className="app-content">{children}</div>
          <BottomNav />
          <PwaRegister />
        </AppProvider></AccountGate>
      </body>
    </html>
  );
}
