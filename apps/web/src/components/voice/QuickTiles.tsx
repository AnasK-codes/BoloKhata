'use client';

import type { Product } from '@bolbill/shared';
import { rupees } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { unitShort } from './units';

/**
 * One tap puts a product on the bill, with no microphone and no internet. These are the shop's
 * most-sold products, so a regular's usual items are always a thumb away.
 */
export function QuickTiles({ products, disabled, onPick }: { products: readonly Product[]; disabled: boolean; onPick(product: Product): void }) {
  const t = useT();
  if (products.length === 0) return null;
  return (
    <section aria-label={t('voice.quickTitle')}>
      <ul className="qt-list">
        {products.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(p)}
              className="qt"
            >
              <b>{p.name}</b>
              <small className="num">{rupees(p.pricePerUnit)}/{unitShort(t, p.unit)}</small>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
