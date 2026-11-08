'use client';

import NumberFlow from '@number-flow/react';

const FORMAT = { style: 'currency', currency: 'INR', maximumFractionDigits: 0 } as const;

/**
 * Whole rupees that roll to their new value (₹1,25,000 grouping, same as `rupees()`). NumberFlow
 * animates with the Web Animations API on transform and opacity, and it stands still when the
 * user prefers reduced motion. The value is always the deterministic total; this is display only.
 */
export function Money({ value, className }: { value: number; className?: string }) {
  return <NumberFlow value={value} format={FORMAT} locales="en-IN" className={className} willChange />;
}
