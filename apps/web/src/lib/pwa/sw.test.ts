import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Runs the real public/sw.js in a sandbox with a fake Cache Storage and a scripted network, to
 * check what it caches and, above all, what it refuses to touch.
 */
const SOURCE = readFileSync(join(__dirname, '../../../public/sw.js'), 'utf8');
const ORIGIN = 'https://app.test';

type Handler = (event: unknown) => void;
interface FakeEvent {
  request?: unknown;
  data?: unknown;
  responded?: Promise<Response>;
  waited?: Promise<unknown>;
  respondWith?(p: Response | Promise<Response>): void;
  waitUntil?(p: Promise<unknown>): void;
}

const key = (r: unknown) => new URL(typeof r === 'string' ? r : (r as { url: string }).url, ORIGIN).href;

class FakeCache {
  entries = new Map<string, Response>();
  async match(r: unknown, options?: { ignoreSearch?: boolean }) {
    const k = key(r);
    const hit = this.entries.get(k) ?? (options?.ignoreSearch ? [...this.entries].find(([u]) => u.split('?')[0] === k.split('?')[0])?.[1] : undefined);
    return hit?.clone();
  }
  async put(r: unknown, res: Response) {
    this.entries.set(key(r), res.clone());
  }
  async addAll(list: string[]) {
    for (const url of list) {
      const res = await network(url);
      if (!res.ok) throw new Error(`addAll ${url}`);
      this.entries.set(key(url), res);
    }
  }
}

let store: Map<string, FakeCache>;
let online: boolean;
let routes: Map<string, () => Response>;
let fetched: string[];
let handlers: Record<string, Handler>;
let skipped: boolean;

async function network(r: unknown): Promise<Response> {
  const url = key(r);
  fetched.push(new URL(url).pathname);
  if (!online) throw new TypeError('offline');
  const route = routes.get(new URL(url).pathname);
  return route ? route() : new Response('not found', { status: 404 });
}

function load() {
  handlers = {};
  skipped = false;
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Handler) => (handlers[type] = fn),
    skipWaiting: () => (skipped = true),
    clients: { claim: async () => undefined },
  };
  const caches = {
    open: async (name: string) => {
      if (!store.has(name)) store.set(name, new FakeCache());
      return store.get(name)!;
    },
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
  };
  vm.runInNewContext(SOURCE, { self, caches, fetch: network, Response, URL, Promise, Set, Error, TypeError, console });
}

const html = (...chunks: string[]) => new Response(`<html>${chunks.map((c) => `<script src="${c}"></script>`).join('')}</html>`, { headers: { 'content-type': 'text/html' } });

function request(path: string, init: { method?: string; mode?: string; upgrade?: string; origin?: string } = {}) {
  const headers = new Map<string, string>();
  if (init.upgrade) headers.set('upgrade', init.upgrade);
  return { method: init.method ?? 'GET', url: new URL(path, init.origin ?? ORIGIN).href, mode: init.mode ?? 'cors', headers: { get: (n: string) => headers.get(n) ?? null } };
}

/** Dispatches a fetch event; resolves to the response, or null if the worker left it alone. */
async function dispatchFetch(req: ReturnType<typeof request>): Promise<Response | null> {
  let responded: Response | Promise<Response> | null = null;
  handlers['fetch']!({ request: req, respondWith: (p: Response | Promise<Response>) => (responded = p) } satisfies FakeEvent);
  return responded === null ? null : await responded;
}

async function install() {
  let waited: Promise<unknown> = Promise.resolve();
  handlers['install']!({ waitUntil: (p: Promise<unknown>) => (waited = p) });
  await waited;
}

const allCachedPaths = () => [...store.values()].flatMap((c) => [...c.entries.keys()].map((u) => new URL(u).pathname));

beforeEach(() => {
  store = new Map();
  online = true;
  fetched = [];
  routes = new Map<string, () => Response>([
    ['/', () => html('/_next/static/chunks/a.js', '/_next/static/chunks/a.css')],
    ['/ledger', () => html('/_next/static/chunks/b.js')],
    ['/bills', () => html('/_next/static/chunks/bills.js')],
    ['/catalog', () => html('/_next/static/chunks/c.js')],
    ['/settings', () => html('/_next/static/chunks/a.js')],
    ['/offline.html', () => new Response('offline page')],
    ['/manifest.webmanifest', () => new Response('{}')],
    ['/icons/icon-192.png', () => new Response('png')],
    ['/icons/icon-512.png', () => new Response('png')],
    ['/icons/icon-maskable-512.png', () => new Response('png')],
    ['/icons/apple-touch-icon.png', () => new Response('png')],
    ['/worklets/capture.js', () => new Response('capture')],
    ['/worklets/playback.js', () => new Response('playback')],
    ['/_next/static/chunks/a.js', () => new Response('a')],
    ['/_next/static/chunks/a.css', () => new Response('a')],
    ['/_next/static/chunks/b.js', () => new Response('b')],
    ['/_next/static/chunks/c.js', () => new Response('c')],
    ['/session', () => new Response('{"token":"secret"}')],
    ['/healthz', () => new Response('{"ok":true}')],
  ]);
  load();
});

describe('install', () => {
  it('saves the pages, the worklets, the icons and the hashed files each page uses', async () => {
    await install();
    const cached = allCachedPaths();
    for (const path of ['/', '/ledger', '/bills', '/catalog', '/settings', '/offline.html', '/worklets/capture.js', '/worklets/playback.js', '/manifest.webmanifest', '/_next/static/chunks/a.js', '/_next/static/chunks/b.js', '/_next/static/chunks/a.css']) {
      expect(cached).toContain(path);
    }
  });

  it('fails the install (so the old worker stays) when a page cannot be fetched', async () => {
    routes.set('/ledger', () => new Response('boom', { status: 500 }));
    await expect(install()).rejects.toThrow();
  });
});

describe('what it never touches', () => {
  beforeEach(install);

  it.each([
    ['POST /session', request('/session', { method: 'POST' })],
    ['GET /session', request('/session')],
    ['a websocket upgrade', request('/ws?token=abc', { upgrade: 'websocket' })],
    ['/ws', request('/ws')],
    ['/healthz', request('/healthz')],
    ['/metrics', request('/metrics')],
    ['a gateway on another origin', request('/session', { method: 'POST', origin: 'https://gateway.test' })],
    ['any cross-origin GET', request('/anything', { origin: 'https://cdn.test' })],
    ['a PUT', request('/ledger', { method: 'PUT' })],
    ['account session', request('/api/account')],
    ['account mutation', request('/api/account/profile', { method: 'POST' })],
  ])('leaves %s to the network', async (_name, req) => {
    expect(await dispatchFetch(req)).toBeNull();
  });

  it('never stores gateway paths, even if they are requested', async () => {
    for (const path of ['/session', '/healthz', '/ws']) await dispatchFetch(request(path));
    await dispatchFetch(request('/session', { method: 'POST' }));
    expect(allCachedPaths().filter((p) => ['/session', '/healthz', '/ws', '/metrics'].includes(p))).toEqual([]);
  });
});

describe('serving', () => {
  beforeEach(install);

  it('opens a saved page offline', async () => {
    online = false;
    const res = await dispatchFetch(request('/ledger', { mode: 'navigate' }));
    expect(await res!.text()).toContain('/_next/static/chunks/b.js');
  });

  it('prefers the network for pages and keeps the fresh copy', async () => {
    routes.set('/ledger', () => html('/_next/static/chunks/new.js'));
    const res = await dispatchFetch(request('/ledger', { mode: 'navigate' }));
    expect(await res!.text()).toContain('new.js');
    online = false;
    expect(await (await dispatchFetch(request('/ledger', { mode: 'navigate' })))!.text()).toContain('new.js');
  });

  it('shows the offline page for an unsaved page', async () => {
    online = false;
    const res = await dispatchFetch(request('/never-visited', { mode: 'navigate' }));
    expect(await res!.text()).toBe('offline page');
  });

  it('serves hashed files from the cache without the network', async () => {
    online = false;
    fetched = [];
    const res = await dispatchFetch(request('/_next/static/chunks/b.js'));
    expect(await res!.text()).toBe('b');
    expect(fetched).toEqual([]);
  });

  it('serves the worklets offline too', async () => {
    online = false;
    expect(await (await dispatchFetch(request('/worklets/capture.js')))!.text()).toBe('capture');
  });

  it('does not store error responses', async () => {
    routes.set('/oops', () => new Response('x', { status: 500 }));
    await dispatchFetch(request('/oops'));
    expect(allCachedPaths()).not.toContain('/oops');
  });
});

describe('updates', () => {
  it('waits for the app to say go before taking over', () => {
    load();
    expect(skipped).toBe(false);
    handlers['message']!({ data: { type: 'SKIP_WAITING' } });
    expect(skipped).toBe(true);
  });

  it('drops caches from older versions when it activates', async () => {
    store.set('bolbill-shell-v0', new FakeCache());
    store.set('unrelated-cache', new FakeCache());
    await install();
    let waited: Promise<unknown> = Promise.resolve();
    handlers['activate']!({ waitUntil: (p: Promise<unknown>) => (waited = p) });
    await waited;
    expect([...store.keys()].sort()).toEqual(['bolbill-assets-v5', 'bolbill-shell-v5', 'unrelated-cache']);
  });
});
