import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildServer } from './server';
import { testConfig } from './testConfig';
import { GATEWAY_VERSION } from './version';

function captureLogs() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { stream, text: () => lines.join('') };
}

describe('gateway server', () => {
  it('GET /healthz returns ok and the version', async () => {
    const app = buildServer(testConfig({ LOG_LEVEL: 'silent' }));
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, version: GATEWAY_VERSION });
    await app.close();
  });

  it('never logs request bodies, query strings or secret headers', async () => {
    const log = captureLogs();
    const app = buildServer(testConfig(), { logStream: log.stream });
    app.post('/echo', () => ({ ok: true }));
    await app.inject({
      method: 'POST',
      url: '/echo?token=SECRET_TOKEN_VALUE',
      headers: { 'x-api-key-id': 'SECRET_KEY_VALUE', 'content-type': 'application/json' },
      payload: { transcript: 'SECRET_TRANSCRIPT_TEXT' },
    });
    await app.close();
    const output = log.text();
    expect(output).toContain('/echo');
    expect(output).not.toContain('SECRET_TRANSCRIPT_TEXT');
    expect(output).not.toContain('SECRET_TOKEN_VALUE');
    expect(output).not.toContain('SECRET_KEY_VALUE');
  });
});
