/**
 * Minimal typed event emitter. Not Node's EventEmitter on purpose: its special `error` event
 * throws when nobody listens, and typed payload tuples are easier to keep honest here.
 */
export type EventMap = Record<string, unknown[]>;

type AnyListener = (...args: unknown[]) => void;

export class TypedEmitter<Events extends EventMap> {
  private readonly listeners = new Map<keyof Events, AnyListener[]>();

  on<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this {
    const list = this.listeners.get(event) ?? [];
    // The map is keyed by event name, so each list only ever holds listeners for that event's tuple.
    list.push(listener as unknown as AnyListener);
    this.listeners.set(event, list);
    return this;
  }

  emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
    const list = this.listeners.get(event);
    if (!list) return;
    for (const listener of list.slice()) listener(...args);
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}
