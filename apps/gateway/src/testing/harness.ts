import type { FastifyInstance } from 'fastify';
import { Writable } from 'node:stream';
import { buildServer, type BuildServerOptions } from '../server';
import { testConfig } from '../testConfig';
import { WsTestClient } from './client';

export const TEST_ORIGIN = 'http://localhost:3000';

export const HELLO = {
  type: 'hello',
  v: 2,
  clientTime: 0,
  lang: 'hi-IN',
  catalog: {
    version: 1,
    products: [
      { id: 'p1', name: 'Aata', aliases: ['atta'], unit: 'kg', pricePerUnit: 45 },
      { id: 'p2', name: 'Cheeni', aliases: ['sugar'], unit: 'kg', pricePerUnit: 50 },
    ],
    customers: [{ id: 'c1', name: 'Sharma ji', aliases: ['Sharma uncle'], balance: 120 }],
  },
};

export interface Harness {
  app: FastifyInstance;
  baseUrl: string;
  wsUrl(token: string): string;
  token(): Promise<string>;
  connect(): Promise<WsTestClient>;
  /** Connects, sends hello (the default catalog unless one is given) and waits for `ready`. */
  ready(hello?: unknown): Promise<WsTestClient>;
  close(): Promise<void>;
}

/** A real listening gateway on a free port, for end-to-end tests with a real websocket. */
export async function startGateway(
  env: Record<string, string> = {},
  options: BuildServerOptions = {},
  /** Listen on this port (to restart a gateway where the old one was). 0 picks a free one. */
  port = 0,
): Promise<Harness> {
  const app = buildServer(testConfig({ LOG_LEVEL: 'silent', ...env }), options);
  await app.listen({ port, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const wsBase = `ws://127.0.0.1:${address.port}`;
  const clients: WsTestClient[] = [];

  const token = async () => {
    const res = await fetch(`${baseUrl}/session`, {
      method: 'POST',
      headers: { origin: TEST_ORIGIN },
    });
    if (!res.ok) throw new Error(`POST /session ${res.status}`);
    return ((await res.json()) as { token: string }).token;
  };
  const connect = async () => {
    const client = await WsTestClient.connect(`${wsBase}/ws?token=${await token()}`);
    clients.push(client);
    return client;
  };
  return {
    app,
    baseUrl,
    wsUrl: (t) => `${wsBase}/ws?token=${t}`,
    token,
    connect,
    async ready(hello: unknown = HELLO) {
      const client = await connect();
      client.sendJson(hello);
      await client.next('ready');
      return client;
    },
    async close() {
      for (const client of clients) client.close();
      await app.close();
    },
  };
}

export function captureLogs(): { stream: Writable; text: () => string } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { stream, text: () => lines.join('') };
}
