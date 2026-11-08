import type { Translate } from '@/lib/i18n';

/** Units are stored as fixed codes (kg, packet...); only their display follows the interface language. */
export function unitName(t: Translate, unit: string): string {
  switch (unit) {
    case 'g': return t('unitName.g');
    case 'l': return t('unitName.l');
    case 'piece': return t('unitName.piece');
    case 'packet': return t('unitName.packet');
    case 'dozen': return t('unitName.dozen');
    default: return unit;
  }
}

/** Short form for tight tiles: kg, g, l and ml are the same everywhere. */
export function unitShort(t: Translate, unit: string): string {
  switch (unit) {
    case 'piece': return t('unit.piece');
    case 'packet': return t('unit.packet');
    case 'dozen': return t('unit.dozen');
    default: return unit;
  }
}
