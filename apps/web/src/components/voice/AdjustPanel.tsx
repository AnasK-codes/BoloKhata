'use client';

import { useState } from 'react';
import { MAX_GST_PERCENT, type BillAdjust } from '@bolbill/shared';

interface Props {
  adjust: BillAdjust | undefined;
  onChange(next: BillAdjust | undefined): void;
}

const GST_CHOICES = [5, 12, 18, MAX_GST_PERCENT] as const;
const digits = (text: string): number => Number(text.replace(/\D/g, '')) || 0;

/** Discount, GST and round-off for the bill on screen. The shared pricing code does the arithmetic. */
export function AdjustPanel({ adjust, onChange }: Props) {
  const [open, setOpen] = useState(adjust !== undefined);
  const percentMode = adjust?.discountPercent !== undefined;
  const discountValue = adjust?.discountPercent ?? adjust?.discountAmount ?? 0;

  const setDiscount = (value: number, percent: boolean) => {
    const { discountAmount: _a, discountPercent: _p, ...rest } = adjust ?? {};
    if (value <= 0) return onChange(rest);
    onChange(percent ? { ...rest, discountPercent: Math.min(100, value) } : { ...rest, discountAmount: value });
  };

  if (!open) {
    return <button type="button" className="tool-open" onClick={() => setOpen(true)}>+ Chhoot / GST / Round-off</button>;
  }

  return (
    <fieldset className="tool-panel">
      <legend>Chhoot, GST, Round-off</legend>
      <div className="tool-row">
        <label htmlFor="adj-discount" className="tool-label">Chhoot</label>
        <input
          id="adj-discount"
          inputMode="numeric"
          value={discountValue === 0 ? '' : discountValue}
          placeholder="0"
          onChange={(e) => setDiscount(digits(e.target.value), percentMode)}
          className="num min-h-12 w-24 rounded-2xl bg-card px-3 text-right text-lg"
        />
        <button type="button" className="chip" aria-pressed={!percentMode} onClick={() => setDiscount(discountValue, false)}>₹</button>
        <button type="button" className="chip" aria-pressed={percentMode} onClick={() => setDiscount(discountValue, true)}>%</button>
      </div>
      <div className="tool-row" role="group" aria-label="GST">
        <span className="tool-label">GST</span>
        <button type="button" className="chip" aria-pressed={adjust?.gstPercent === undefined} onClick={() => { const { gstPercent: _g, ...rest } = adjust ?? {}; onChange(rest); }}>Nahi</button>
        {GST_CHOICES.map((rate) => (
          <button key={rate} type="button" className="chip" aria-pressed={adjust?.gstPercent === rate} onClick={() => onChange({ ...adjust, gstPercent: rate })}>{rate}%</button>
        ))}
      </div>
      <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3 font-semibold">
        <span>Round-off <span className="font-normal text-muted">(nazdeeki ₹5)</span></span>
        <input type="checkbox" role="switch" checked={adjust?.roundOff === true} onChange={(e) => onChange({ ...adjust, roundOff: e.target.checked })} className="h-7 w-7 accent-[var(--c-accent)]" />
      </label>
    </fieldset>
  );
}
