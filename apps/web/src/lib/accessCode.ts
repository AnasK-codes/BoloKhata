const KEY = 'bolbill.accessCode.v1';

/** The demo access code the visitor typed, kept on this device so it is asked for only once. */
export function getAccessCode(): string | undefined {
  try {
    return globalThis.localStorage?.getItem(KEY)?.trim() || undefined;
  } catch {
    return undefined; // storage blocked: the code is asked for again next visit
  }
}

export function setAccessCode(code: string): void {
  try {
    globalThis.localStorage?.setItem(KEY, code.trim());
  } catch {
    // not saved; it is still used for this connection attempt through the caller
  }
}
