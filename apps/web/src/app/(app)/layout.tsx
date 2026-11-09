import type { ReactNode } from 'react';
import { AppProvider } from '@/components/AppProvider';
import { BottomNav } from '@/components/BottomNav';
import { PwaRegister } from '@/components/PwaRegister';
import { AccountGate } from '@/components/AccountGate';

/** Everything behind the landing page: account gate, local data, the voice connection and the nav. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AccountGate><AppProvider>
      <div className="app-content">{children}</div>
      <BottomNav />
      <PwaRegister />
    </AppProvider></AccountGate>
  );
}
