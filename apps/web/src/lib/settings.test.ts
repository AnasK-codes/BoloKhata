import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from './settings';

describe('dialect setting', () => {
  it('defaults to auto and keeps a saved dialect', () => {
    expect(parseSettings(null).dialect).toBe('auto');
    expect(parseSettings(JSON.stringify({ ...DEFAULT_SETTINGS, dialect: 'malwi' })).dialect).toBe('malwi');
  });
  it('falls back to auto for anything it does not know', () => {
    expect(parseSettings(JSON.stringify({ dialect: 'klingon' })).dialect).toBe('auto');
    expect(parseSettings(JSON.stringify({ dialect: 3 })).dialect).toBe('auto');
  });
});
