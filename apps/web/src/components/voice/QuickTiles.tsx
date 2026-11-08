'use client';

import type { Product } from '@bolbill/shared';
import { rupees } from '@/lib/format';

const UNIT_LABEL: Record<string, string> = { kg: 'kg', g: 'g', l: 'l', ml: 'ml', piece: 'pc', packet: 'pkt', dozen: 'darjan' };

/**
 * One tap puts a product on the bill, with no microphone and no internet. These are the shop's
 * most-sold products, so a regular's usual items are always a thumb away.
 */
export function QuickTiles({ products, disabled, onPick }: { products: readonly Product[]; disabled: boolean; onPick(product: Product): void }) {
  if (products.length === 0) return null;
  return (
    <section aria-label="Jaldi chuno">
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
              <small className="num">{rupees(p.pricePerUnit)}/{UNIT_LABEL[p.unit] ?? p.unit}</small>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
