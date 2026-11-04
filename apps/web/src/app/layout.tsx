import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AppProvider } from '@/components/AppProvider';
import { BottomNav } from '@/components/BottomNav';
import { PwaRegister } from '@/components/PwaRegister';
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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f2f3f6' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1115' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <AppProvider>
          <div className="pb-[calc(5.5rem+env(safe-area-inset-bottom))]">{children}</div>
          <BottomNav />
          <PwaRegister />
        </AppProvider>
      </body>
    </html>
  );
}
