'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/', label: 'Bolo', hint: 'Voice', icon: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V22h2v-3.1A7 7 0 0 0 19 12h-2Z' },
  { href: '/ledger', label: 'Khata', hint: 'Ledger', icon: 'M5 3h11a3 3 0 0 1 3 3v15H8a3 3 0 0 1-3-3V3Zm3 4v2h8V7H8Zm0 4v2h8v-2H8Z' },
  { href: '/bills', label: 'Bills', hint: 'History', icon: 'M5 3h14v18l-3-2-4 2-4-2-3 2V3Zm3 4v2h8V7H8Zm0 4v2h8v-2H8Z' },
  { href: '/catalog', label: 'Samaan', hint: 'Catalog', icon: 'M3 7l9-4 9 4v10l-9 4-9-4V7Zm9-1.8L6.2 7.7 12 10.3l5.8-2.6L12 5.2Z' },
  { href: '/settings', label: 'Settings', hint: 'Settings', icon: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9 5v-2l-2.1-.6a7 7 0 0 0-.7-1.7l1.1-1.9-1.4-1.4-1.9 1.1a7 7 0 0 0-1.7-.7L13.7 3h-2l-.6 2.1a7 7 0 0 0-1.7.7L7.5 4.7 6.1 6.1l1.1 1.9a7 7 0 0 0-.7 1.7L4.4 10.3v2l2.1.6c.2.6.4 1.2.7 1.7l-1.1 1.9 1.4 1.4 1.9-1.1c.5.3 1.1.5 1.7.7l.6 2.1h2l.6-2.1c.6-.2 1.2-.4 1.7-.7l1.9 1.1 1.4-1.4-1.1-1.9c.3-.5.5-1.1.7-1.7l2.1-.6Z' },
];

export function BottomNav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-canvas/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto flex max-w-md">
        {ITEMS.map((item) => {
          const active = item.href === '/' ? path === '/' : path.startsWith(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                aria-label={`${item.label} (${item.hint})`}
                className={`flex min-h-16 flex-col items-center justify-center gap-0.5 text-sm font-semibold ${active ? 'text-accent' : 'text-muted'}`}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={item.icon} /></svg>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
