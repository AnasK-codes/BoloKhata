'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { useT } from '@/lib/i18n';

/** Shown for any address the app does not have. Next sends it with a real 404 status. */
export default function NotFound() {
  const t = useT();
  const links = [
    { href: '/', label: t('nav.voice') },
    { href: '/ledger', label: t('nav.ledger') },
    { href: '/bills', label: t('nav.bills') },
    { href: '/catalog', label: t('nav.catalog') },
  ];
  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center gap-5 px-6 py-12 text-center" data-testid="not-found">
      <span className="grid h-20 w-20 place-items-center rounded-3xl bg-control text-dim" aria-hidden="true"><Icon name="alert" size={40} /></span>
      <p className="num text-sm font-semibold tracking-wide text-muted">{t('notFound.code')}</p>
      <h1 className="text-3xl font-extrabold leading-tight">{t('notFound.title')}</h1>
      <p className="text-lg text-dim">{t('notFound.hint')}</p>
      <Link href="/" className="inline-flex min-h-14 items-center justify-center rounded-2xl bg-accent px-6 text-lg font-bold text-on-solid">{t('notFound.home')}</Link>
      <nav aria-label={t('notFound.title')} className="flex flex-wrap justify-center gap-2">
        {links.map((l) => <Link key={l.href} href={l.href} className="inline-flex min-h-12 items-center rounded-xl bg-control px-4 font-semibold">{l.label}</Link>)}
      </nav>
    </main>
  );
}
