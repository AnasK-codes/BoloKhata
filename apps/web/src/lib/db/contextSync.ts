import { liveQuery } from 'dexie';
import type { ClientMessage } from '@bolbill/shared';
import type { CatalogSnapshot } from '../realtime/types';
import { buildSnapshot } from './snapshot';
import type { BolDb } from './schema';

export interface ContextSyncOptions {
  db: BolDb;
  send: (message: ClientMessage) => boolean;
  debounceMs?: number;
}

/**
 * Keeps the gateway's in-memory copy of the catalog current. After any change to products,
 * customers or the ledger (a save, a payment, a catalog edit) a `context_update` goes out, once
 * things have been quiet for a moment. The first snapshot a session sees is its `hello`, so
 * `markSent` records what `hello` carried and an unchanged catalog sends nothing.
 */
export class ContextSync {
  private lastSent = '';
  private version = Date.now();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private subscription: { unsubscribe(): void } | undefined;

  constructor(private readonly options: ContextSyncOptions) {}

  /** For `hello` on every (re)connect. Records it as sent. */
  async snapshotForHello(): Promise<CatalogSnapshot> {
    const snapshot = await buildSnapshot(this.options.db);
    this.lastSent = fingerprint(snapshot);
    return { ...snapshot, version: ++this.version };
  }

  start(): void {
    this.subscription = liveQuery(() => buildSnapshot(this.options.db)).subscribe({
      next: (snapshot) => this.schedule(snapshot),
      error: () => undefined, // a failed read must not break the app; the next change retries
    });
  }

  stop(): void {
    this.subscription?.unsubscribe();
    clearTimeout(this.timer);
  }

  private schedule(snapshot: CatalogSnapshot): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(snapshot), this.options.debounceMs ?? 400);
  }

  private flush(snapshot: CatalogSnapshot): void {
    const print = fingerprint(snapshot);
    if (print === this.lastSent) return;
    const sent = this.options.send({
      type: 'context_update',
      catalog: { version: ++this.version, products: snapshot.products, customers: snapshot.customers },
    });
    // If the socket was down, keep the difference pending: the next hello will carry it.
    if (sent) this.lastSent = print;
  }
}

function fingerprint(snapshot: CatalogSnapshot): string {
  return JSON.stringify([snapshot.products, snapshot.customers]);
}
