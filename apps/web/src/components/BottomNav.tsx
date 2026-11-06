'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from './Icon';

const ITEMS: { href: string; label: string; hint: string; icon: IconName }[] = [
  { href: '/', label: 'Bolo', hint: 'Voice', icon: 'mic' },
  { href: '/ledger', label: 'Khata', hint: 'Ledger', icon: 'book' },
  { href: '/bills', label: 'Bills', hint: 'History', icon: 'receipt' },
  { href: '/catalog', label: 'Samaan', hint: 'Catalog', icon: 'box' },
  { href: '/settings', label: 'Settings', hint: 'Settings', icon: 'gear' },
];

export function BottomNav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="app-nav">
      <Link href="/" className="nav-brand">Bol<span>Bill.</span><small>Aapki dukaan ka voice assistant</small></Link>
      <ul>
        {ITEMS.map((item) => {
          const active = item.href === '/' ? path === '/' : path.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                aria-label={`${item.label} (${item.hint})`}
                className={`nav-item ${active ? 'nav-active' : ''}`}
              >
                <Icon name={item.icon} size={24} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="nav-note"><strong>Bolkar kaam aasaan.</strong><p>Bill, khata aur samaan — sab ek jagah.</p></div>
    </nav>
  );
}
