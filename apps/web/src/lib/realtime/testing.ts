/** Fakes for the client tests: a scripted WebSocket and a scripted fetch. */

export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static reset(): void {
    FakeWebSocket.instances = [];
  }
  static get last(): FakeWebSocket {
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error('no socket was opened');
    return ws;
  }

  readyState = 0;
  binaryType = 'blob';
  bufferedAmount = 0;
  sent: (string | ArrayBuffer)[] = [];
  closedWith: number | undefined;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string | ArrayBuffer): void {
    this.sent.push(data);
  }

  close(code = 1000): void {
    this.closedWith = code;
    this.readyState = 3;
  }

  /** Test controls. */
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(data: unknown): void {
    this.onmessage?.({ data: typeof data === 'string' ? data : data });
  }
  receiveJson(message: unknown): void {
    this.receive(JSON.stringify(message));
  }
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  get sentJson(): Record<string, unknown>[] {
    return this.sent.filter((d): d is string => typeof d === 'string').map((d) => JSON.parse(d) as Record<string, unknown>);
  }
  get sentBinary(): ArrayBuffer[] {
    return this.sent.filter((d): d is ArrayBuffer => typeof d !== 'string');
  }
}

export const READY = {
  type: 'ready',
  v: 1,
  sessionId: 's1',
  limits: { maxSessionMinutes: 10, maxUtteranceSeconds: 20 },
  audio: { inputSampleRate: 16000, inputFrameBytes: 1024 },
};

export const CATALOG = {
  version: 3,
  products: [{ id: 'p1', name: 'Aata', aliases: [], unit: 'kg' as const, pricePerUnit: 45 }],
  customers: [{ id: 'c1', name: 'Sharma ji', aliases: [], balance: 120 }],
};

export interface FakeFetch {
  fetch: typeof fetch;
  calls: { url: string; init: RequestInit | undefined }[];
  /** Responses are used in order; the last one repeats. */
  respond(...responses: Response[]): void;
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function fakeFetch(): FakeFetch {
  const queue: Response[] = [];
  const calls: FakeFetch['calls'] = [];
  const fn = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (!next) return Promise.reject(new Error('network down'));
    return Promise.resolve(next.clone());
  }) as unknown as typeof fetch;
  return {
    fetch: fn,
    calls,
    respond: (...responses) => {
      queue.length = 0;
      queue.push(...responses);
    },
  };
}
