'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Icon, type IconName } from '../Icon';
import { useT, type MessageKey } from '@/lib/i18n';

const STEPS: { n: number; icon: IconName; title: MessageKey; body: MessageKey }[] = [
  { n: 1, icon: 'mic', title: 'landing.step1.title', body: 'landing.step1.body' },
  { n: 2, icon: 'receipt', title: 'landing.step2.title', body: 'landing.step2.body' },
  { n: 3, icon: 'check', title: 'landing.step3.title', body: 'landing.step3.body' },
];

const FEATURES: { icon: IconName; title: MessageKey; body: MessageKey }[] = [
  { icon: 'mic', title: 'landing.f1.title', body: 'landing.f1.body' },
  { icon: 'book', title: 'landing.f2.title', body: 'landing.f2.body' },
  { icon: 'box', title: 'landing.f3.title', body: 'landing.f3.body' },
  { icon: 'alert', title: 'landing.f4.title', body: 'landing.f4.body' },
  { icon: 'receipt', title: 'landing.f5.title', body: 'landing.f5.body' },
  { icon: 'user', title: 'landing.f6.title', body: 'landing.f6.body' },
];

const SAYINGS: MessageKey[] = ['landing.say1', 'landing.say2', 'landing.say3', 'landing.say4'];

/** What the visitor sees at the root address. Everything that needs an account lives under /app. */
export function Landing() {
  const t = useT();
  return (
    <div className="lp">
      <header className="lp-top">
        <Link href="/" className="lp-brand" aria-label={t('app.name')}>
          <Image src="/brand/bolokhata-logo.png" alt={t('app.name')} width={1000} height={327} priority className="lp-logo" />
        </Link>
        <nav aria-label={t('landing.nav')}>
          <Link href="/app" className="lp-btn lp-btn-solid lp-btn-sm">{t('landing.openApp')}</Link>
        </nav>
      </header>

      <main>
        <section className="lp-hero" aria-labelledby="lp-title">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow">{t('landing.eyebrow')}</p>
            <h1 id="lp-title" className="lp-title">{t('landing.title')}</h1>
            <p className="lp-lead">{t('landing.lead')}</p>
            <div className="lp-actions">
              <Link href="/app" className="lp-btn lp-btn-brand">
                <Icon name="mic" size={22} />{t('landing.openApp')}
              </Link>
              <a href="#how" className="lp-btn lp-btn-ghost">{t('landing.how')}</a>
            </div>
            <p className="lp-powered">{t('landing.powered')}</p>
          </div>

          <div className="lp-phone" aria-hidden="true">
            <div className="lp-phone-screen">
              <p className="lp-said">{t('landing.mock.said')}</p>
              <div className="lp-bill">
                {/* A picture of a bill, not data: product names are shown the same in every language. */}
                <div className="lp-bill-line"><span>Aata <small>2 kg</small></span><b>₹90</b></div> {/* i18n-ignore: illustration */}
                <div className="lp-bill-line"><span>Cheeni <small>1 kg</small></span><b>₹48</b></div> {/* i18n-ignore: illustration */}
                <div className="lp-bill-total"><span>{t('landing.mock.total')}</span><b>₹138</b></div>
                <span className="lp-chip">{t('landing.mock.unpaid')}</span>
              </div>
              <p className="lp-reply"><Icon name="speaker" size={16} />{t('landing.mock.reply')}</p>
              <div className="lp-mic"><i /><i /><span><Icon name="mic" size={30} /></span></div>
            </div>
          </div>
        </section>

        <section id="how" className="lp-section" aria-labelledby="lp-steps">
          <h2 id="lp-steps" className="lp-h2">{t('landing.stepsTitle')}</h2>
          <ol className="lp-steps">
            {STEPS.map((s) => (
              <li key={s.n} className="lp-step">
                <span className="lp-step-n" aria-hidden="true">{s.n}</span>
                <span className="lp-ico" aria-hidden="true"><Icon name={s.icon} size={26} /></span>
                <h3>{t(s.title)}</h3>
                <p>{t(s.body)}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="lp-section" aria-labelledby="lp-features">
          <h2 id="lp-features" className="lp-h2">{t('landing.featuresTitle')}</h2>
          <ul className="lp-grid">
            {FEATURES.map((f) => (
              <li key={f.title} className="lp-card">
                <span className="lp-ico" aria-hidden="true"><Icon name={f.icon} size={24} /></span>
                <h3>{t(f.title)}</h3>
                <p>{t(f.body)}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="lp-section lp-say" aria-labelledby="lp-say">
          <h2 id="lp-say" className="lp-h2">{t('landing.trySay')}</h2>
          <ul className="lp-bubbles">
            {SAYINGS.map((k, i) => <li key={k} style={{ ['--i' as string]: i }}>{t(k)}</li>)}
          </ul>
        </section>

        <section className="lp-cta" aria-labelledby="lp-cta">
          <Image src="/brand/bolokhata-mark.png" alt="" width={360} height={385} className="lp-cta-mark" />
          <h2 id="lp-cta" className="lp-h2">{t('landing.ctaTitle')}</h2>
          <p>{t('landing.ctaBody')}</p>
          <Link href="/app" className="lp-btn lp-btn-brand lp-btn-lg"><Icon name="mic" size={24} />{t('landing.openApp')}</Link>
        </section>
      </main>

      <footer className="lp-foot">
        <p>{t('landing.footer')}</p>
        <p>{t('landing.powered')}</p>
      </footer>
    </div>
  );
}
