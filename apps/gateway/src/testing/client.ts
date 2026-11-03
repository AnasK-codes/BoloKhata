import { WebSocket } from 'ws';

export type Msg = Record<string, unknown>;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Websocket client for tests: records JSON and binary messages and waits for specific ones. */
export class WsTestClient {
  readonly messages: Msg[] = [];
  readonly binary: Buffer[] = [];
  closed: { code: number; reason: string } | undefined;
  private cursor = 0;
  private waiters: (() => void)[] = [];

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data, isBinary) => {
      if (isBinary) this.binary.push(data as Buffer);
      else this.messages.push(JSON.parse(data.toString()) as Msg);
      this.wake();
    });
    ws.on('close', (code, reason) => {
      this.closed = { code, reason: reason.toString() };
      this.wake();
    });
  }

  /** Rejects with the HTTP status when the upgrade is refused. */
  static connect(url: string, headers: Record<string, string> = {}): Promise<WsTestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { headers });
      const client = new WsTestClient(ws);
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

  async next(type: string, timeoutMs = 3000): Promise<Msg> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      while (this.cursor < this.messages.length) {
        const message = this.messages[this.cursor++];
        if (message !== undefined && message['type'] === type) return message;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`timed out waiting for ${type}`);
      await this.waitForActivity(remaining);
    }
  }

  /** Waits until `count` binary frames have arrived in total. */
  async waitBinary(count: number, timeoutMs = 3000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.binary.length < count) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`timed out waiting for ${count} binary frames`);
      await this.waitForActivity(remaining);
    }
  }

  async waitClosed(timeoutMs = 3000): Promise<{ code: number; reason: string }> {
    const deadline = Date.now() + timeoutMs;
    while (this.closed === undefined) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('timed out waiting for close');
      await this.waitForActivity(remaining);
    }
    return this.closed;
  }

  has(type: string): boolean {
    return this.messages.some((m) => m['type'] === type);
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
