import { describe, expect, it } from 'vitest';
import { reminderLink, reminderText } from './reminder';

describe('reminderText', () => {
  it('names the shop, the amount and how long it has been pending', () => {
    const text = reminderText({ businessName: 'Demo Kirana', customerName: 'Mohan Lal', balance: 450, days: 12 });
    expect(text).toContain('Mohan Lal');
    expect(text).toContain('Demo Kirana');
    expect(text).toContain('450');
    expect(text).toContain('12 din');
  });

  it('leaves out the days when they are unknown or under a day', () => {
    expect(reminderText({ businessName: 'Demo Kirana', customerName: 'Mohan Lal', balance: 450 })).not.toContain('din se');
    expect(reminderText({ businessName: 'Demo Kirana', customerName: 'Mohan Lal', balance: 450, days: 0 })).not.toContain('din se');
  });

  it('is empty when nothing is owed, so no reminder can be sent by mistake', () => {
    expect(reminderText({ businessName: 'Demo Kirana', customerName: 'Mohan Lal', balance: 0 })).toBe('');
    expect(reminderText({ businessName: 'Demo Kirana', customerName: 'Mohan Lal', balance: -20 })).toBe('');
  });
});

describe('reminderLink', () => {
  it('opens a chat with a saved Indian mobile number', () => {
    const link = reminderLink('9876543210', 'Namaste');
    expect(link).toBe('https://wa.me/919876543210?text=Namaste');
  });

  it('opens the contact picker when there is no valid number', () => {
    expect(reminderLink(undefined, 'Namaste')).toBe('https://wa.me/?text=Namaste');
    expect(reminderLink('12345', 'Namaste')).toBe('https://wa.me/?text=Namaste');
  });

  it('encodes the message and never puts a number it did not validate into the URL', () => {
    const link = reminderLink('98765 43210; DROP', 'Rs 5 & more\nline 2');
    expect(link?.startsWith('https://wa.me/?text=')).toBe(true);
    expect(link).toContain('Rs%205%20%26%20more%0Aline%202');
  });

  it('returns null for an empty message', () => {
    expect(reminderLink('9876543210', '')).toBeNull();
  });
});
