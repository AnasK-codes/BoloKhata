'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from './Icon';
import { useT, type MessageKey } from '@/lib/i18n';

const ITEMS: { href: string; label: MessageKey; icon: IconName }[] = [
  { href: '/', label: 'nav.voice', icon: 'mic' },
  { href: '/ledger', label: 'nav.ledger', icon: 'book' },
  { href: '/bills', label: 'nav.bills', icon: 'receipt' },
  { href: '/catalog', label: 'nav.catalog', icon: 'box' },
  { href: '/settings', label: 'nav.settings', icon: 'gear' },
];

export function BottomNav() {
  const t = useT();
  const path = usePathname();
  return (
    <nav aria-label={t('nav.main')} className="app-nav">
      <Link href="/" className="nav-brand"><Image src="/icons/logo.png" alt={t('app.name')} width={28} height={28} className="rounded-md" />{t('app.name')}</Link>
      <ul>
        {ITEMS.map((item) => {
          const active = item.href === '/' ? path === '/' : path.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`nav-item ${active ? 'nav-active' : ''}`}
              >
                <Icon name={item.icon} size={24} />
                {t(item.label)}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="nav-note"><strong>{t('nav.noteTitle')}</strong><p>{t('nav.noteBody')}</p></div>
    </nav>
  );
}
