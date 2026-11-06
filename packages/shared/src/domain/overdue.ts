import type { LedgerEntry } from './types';

const DAY_MS = 86_400_000;

/** Whole days from `from` to `now`, never negative. */
export function daysSince(from: number, now: number): number {
  return Math.max(0, Math.floor((now - from) / DAY_MS));
}

/**
 * The date of the oldest udhaar that is still unpaid, or null when nothing is owed. Payments settle
 * the oldest udhaar first (how a shopkeeper thinks about "purana hisab"), and money paid beyond what
 * is owed is an advance that settles the next udhaar. A reversed udhaar and its reversal cancel out,
 * so a payment that had settled it settles the next one; a reversal of a payment is a new debt from
 * the day it was reversed. Entries are for ONE customer; the order they are passed in does not matter.
 */
export function oldestUnpaidSince(entries: readonly LedgerEntry[]): number | null {
  const udhaarIds = new Set(entries.filter((e) => e.type === 'udhaar').map((e) => e.id));
  const reversed = new Set(entries.filter((e) => e.type === 'payment' && e.reversesEntryId && udhaarIds.has(e.reversesEntryId)).map((e) => e.reversesEntryId));
  const ordered = entries
    .filter((e) => !(e.type === 'udhaar' && reversed.has(e.id)) && !(e.type === 'payment' && e.reversesEntryId && reversed.has(e.reversesEntryId)))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const lots: { createdAt: number; remaining: number }[] = [];
  let advance = 0;
  for (const entry of ordered) {
    if (entry.type === 'udhaar') {
      const used = Math.min(advance, entry.amount);
      advance -= used;
      lots.push({ createdAt: entry.createdAt, remaining: entry.amount - used });
      continue;
    }
    let left = entry.amount;
    for (const lot of lots) {
      if (left <= 0) break;
      const used = Math.min(lot.remaining, left);
      lot.remaining -= used;
      left -= used;
    }
    advance += left;
  }
  return lots.find((lot) => lot.remaining > 0)?.createdAt ?? null;
}
