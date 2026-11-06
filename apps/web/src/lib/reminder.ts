import { rupees } from './format';

export interface ReminderInput {
  businessName: string;
  customerName: string;
  /** Positive means the customer owes the shop. */
  balance: number;
  /** Days since the oldest unpaid udhaar, when known. */
  days?: number | null;
}

/** A polite Hinglish nudge. Empty when nothing is owed, so a reminder cannot go out by mistake. */
export function reminderText({ businessName, customerName, balance, days }: ReminderInput): string {
  if (balance <= 0) return '';
  const since = days && days > 0 ? ` (${days} din se)` : '';
  return `Namaste ${customerName}, ${businessName} se yaad dilana tha: aapka ${rupees(balance)} udhaar baaki hai${since}. Jab suvidha ho, de dijiye. Dhanyavaad!`;
}

/**
 * A wa.me link: opens the chat for a valid 10 digit Indian mobile, otherwise WhatsApp's own contact
 * picker. Nothing is sent by us; the shopkeeper reads the message and taps send. Only digits that
 * passed the check reach the URL.
 */
export function reminderLink(mobile: string | undefined, text: string): string | null {
  if (text === '') return null;
  const valid = mobile !== undefined && /^[6-9]\d{9}$/.test(mobile);
  return `https://wa.me/${valid ? `91${mobile}` : ''}?text=${encodeURIComponent(text)}`;
}
