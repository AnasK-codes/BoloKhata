import { describe, expect, it } from 'vitest';
import { SendQueue, type SocketLike } from './sendQueue';
import { TurnTimer } from '../timing';

function fakeSocket(): SocketLike & { sent: unknown[]; closedWith: number | undefined } {
  const socket = {
    readyState: 1,
    bufferedAmount: 0,
    sent: [] as unknown[],
    closedWith: undefined as number | undefined,
    send(data: string | Uint8Array) {
      socket.sent.push(data);
    },
    close(code?: number) {
      socket.closedWith = code;
      socket.readyState = 3;
    },
  };
  return socket;
}

describe('SendQueue', () => {
  it('sends valid JSON and refuses an invalid outbound message', () => {
    const socket = fakeSocket();
    let invalid = '';
    const queue = new SendQueue(socket, {}, (type) => (invalid = type));
    expect(queue.json({ type: 'pong', t: 5 })).toBe(true);
    expect(socket.sent).toEqual(['{"type":"pong","t":5}']);
    // @ts-expect-error deliberately malformed
    expect(queue.json({ type: 'pong' })).toBe(false);
    expect(invalid).toBe('pong');
    expect(socket.sent).toHaveLength(1);
  });

  it('drops TTS audio first when the client is behind', () => {
    const socket = fakeSocket();
    const queue = new SendQueue(socket, { ttsDropBytes: 100 });
    expect(queue.tts(new Uint8Array(10), 1)).toBe(true);
    socket.bufferedAmount = 101;
    expect(queue.tts(new Uint8Array(10), 1)).toBe(false);
    expect(queue.droppedTtsFrames).toBe(1);
    // control messages still go through while only audio is being shed
    expect(queue.json({ type: 'pong', t: 1 })).toBe(true);
  });

  it('discards audio for a stale turn until the turn is made live again', () => {
    const socket = fakeSocket();
    const queue = new SendQueue(socket);
    queue.markStale(7);
    expect(queue.tts(new Uint8Array(4), 7)).toBe(false);
    expect(queue.tts(new Uint8Array(4), 8)).toBe(true);
    queue.markLive(7);
    expect(queue.tts(new Uint8Array(4), 7)).toBe(true);
  });

  it('closes a client that is hopelessly behind instead of queueing', () => {
    const socket = fakeSocket();
    const queue = new SendQueue(socket, { hardLimitBytes: 50 });
    socket.bufferedAmount = 51;
    expect(queue.json({ type: 'pong', t: 1 })).toBe(false);
    expect(socket.closedWith).toBe(1013);
  });

  it('sends nothing on a closed socket', () => {
    const socket = fakeSocket();
    socket.readyState = 3;
    const queue = new SendQueue(socket);
    expect(queue.json({ type: 'pong', t: 1 })).toBe(false);
    expect(queue.tts(new Uint8Array(4), 1)).toBe(false);
  });
});

describe('TurnTimer', () => {
  it('records spans relative to the turn start, first mark wins', () => {
    let now = 100;
    const timer = new TurnTimer(() => now);
    timer.start(1);
    now = 150;
    timer.mark(1, 'release');
    now = 400;
    timer.mark(1, 'release');
    timer.mark(1, 'transcript');
    timer.setParseSource(1, 'rules');
    expect(timer.message(1)).toEqual({
      type: 'timing',
      turnId: 1,
      spans: { release: 50, transcript: 300 },
      parseSource: 'rules',
    });
  });

  it('ignores unknown turns and keeps only recent ones', () => {
    const timer = new TurnTimer(() => 0, 2);
    timer.mark(9, 'release');
    expect(timer.message(9)).toBeNull();
    timer.start(1);
    timer.start(2);
    timer.start(3);
    expect(timer.message(1)).toBeNull();
    expect(timer.message(3)).not.toBeNull();
  });
});
