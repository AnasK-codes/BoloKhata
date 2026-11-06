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
    <section aria-label="Jaldi chuno" className="space-y-2">
      <p className="eyebrow">JALDI CHUNO</p>
      <ul className="-mx-1 flex snap-x gap-2 overflow-x-auto overscroll-x-contain px-1 pb-2">
        {products.map((p) => (
          <li key={p.id} className="shrink-0 snap-start">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(p)}
              className="min-h-14 min-w-24 rounded-xl bg-raised px-4 py-2 text-left font-semibold transition-transform active:scale-95 disabled:opacity-40"
            >
              <span className="block">{p.name}</span>
              <span className="num block text-sm text-dim">{rupees(p.pricePerUnit)}/{UNIT_LABEL[p.unit] ?? p.unit}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
