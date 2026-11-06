import type { LedgerEntry } from './types';

const DAY_MS = 86_400_000;

/** Whole days from `from` to `now`, never negative. */
export function daysSince(from: number, now: number): number {
  return Math.max(0, Math.floor((now - from) / DAY_MS));
}

/**
 * The date of the oldest udhaar that is still unpaid, or null when nothing is owed. Payments settle
 * the oldest udhaar first (how a shopkeeper thinks about "purana hisab"). A reversal of an udhaar
 * removes that exact entry; a reversal of a payment is a new debt from the day it was reversed.
 * Entries are for ONE customer; the order they are passed in does not matter.
 */
export function oldestUnpaidSince(entries: readonly LedgerEntry[]): number | null {
  const ordered = [...entries].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const lots: { id: string; createdAt: number; remaining: number }[] = [];
  for (const entry of ordered) {
    if (entry.type === 'udhaar') {
      lots.push({ id: entry.id, createdAt: entry.createdAt, remaining: entry.amount });
      continue;
    }
    const target = entry.reversesEntryId ? lots.find((lot) => lot.id === entry.reversesEntryId) : undefined;
    if (target) {
      target.remaining = 0;
      continue;
    }
    let left = entry.amount;
    for (const lot of lots) {
      if (left <= 0) break;
      const used = Math.min(lot.remaining, left);
      lot.remaining -= used;
      left -= used;
    }
  }
  return lots.find((lot) => lot.remaining > 0)?.createdAt ?? null;
}
