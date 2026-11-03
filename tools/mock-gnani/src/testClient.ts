import { WebSocket } from 'ws';

export type Msg = Record<string, unknown>;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Thin websocket client for tests: records JSON messages and lets a test wait for one. */
export class TestClient {
  readonly messages: Msg[] = [];
  closed: { code: number; reason: string } | undefined;
  private cursor = 0;
  private waiters: (() => void)[] = [];

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data, isBinary) => {
      if (!isBinary) this.messages.push(JSON.parse(data.toString()) as Msg);
      this.wake();
    });
    ws.on('close', (code, reason) => {
      this.closed = { code, reason: reason.toString() };
      this.wake();
    });
  }

  /** Resolves once the websocket is open; rejects with the HTTP status if the upgrade is refused. */
  static connect(url: string, headers: Record<string, string> = {}): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { headers });
      const client = new TestClient(ws);
      ws.once('open', () => resolve(client));
      ws.once('unexpected-response', (_req, res) => {
        reject(new Error(`HTTP ${res.statusCode}`));
        ws.terminate();
      });
      ws.once('error', () => undefined);
    });
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) waiter();
  }

  private waitForActivity(remainingMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, remainingMs);
      this.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** Waits for the next not-yet-consumed message of `type`. */
  next(type: string, timeoutMs = 2000): Promise<Msg> {
    return this.nextAny([type], timeoutMs);
  }

  /** Waits for the next not-yet-consumed message whose type is any of `types`. */
  async nextAny(types: string[], timeoutMs = 2000): Promise<Msg> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      while (this.cursor < this.messages.length) {
        const message = this.messages[this.cursor++];
        if (message !== undefined && types.includes(String(message['type']))) return message;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`timed out waiting for ${types.join(' or ')}`);
      await this.waitForActivity(remaining);
    }
  }

  async waitClosed(timeoutMs = 2000): Promise<{ code: number; reason: string }> {
    const deadline = Date.now() + timeoutMs;
    while (this.closed === undefined) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('timed out waiting for close');
      await this.waitForActivity(remaining);
    }
    return this.closed;
  }

  sendBinary(data: Uint8Array): void {
    this.ws.send(data);
  }

  sendJson(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  close(): void {
    this.ws.terminate();
  }
}
