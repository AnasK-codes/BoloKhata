import { describe, expect, it } from 'vitest';
import { PlaybackFeed } from './playbackFeed';
import type { PlaybackCommand } from './worklets/messages';

/** A chunk of `ms` milliseconds of 24 kHz audio. */
const chunk = (ms: number) => new ArrayBuffer((24000 * ms) / 1000 * 2);

function setup(capacityMs = 2000) {
  const sent: PlaybackCommand[] = [];
  const feed = new PlaybackFeed(capacityMs, (command) => sent.push(command));
  return { feed, sent, types: () => sent.map((c) => c.type) };
}

describe('PlaybackFeed', () => {
  it('forwards chunks straight away while there is room', () => {
    const { feed, types } = setup();
    feed.begin(1, 24000);
    feed.push(1, chunk(200));
    feed.push(1, chunk(200));
    expect(types()).toEqual(['begin', 'chunk', 'chunk']);
  });

  it('holds back what would overfill the ring and releases it as the worklet drains', () => {
    const { feed, types } = setup(2000);
    feed.begin(1, 24000);
    feed.push(1, chunk(1000));
    feed.push(1, chunk(1000)); // 2000 ms would pass the 75% limit of 1500 ms
    expect(types()).toEqual(['begin', 'chunk']);
    expect(feed.pendingMs).toBeCloseTo(1000);
    feed.onBuffered(400);
    expect(types()).toEqual(['begin', 'chunk', 'chunk']);
    expect(feed.pendingMs).toBe(0);
  });

  it('accepts one oversized chunk into an empty ring instead of stalling', () => {
    const { feed, types } = setup(2000);
    feed.begin(1, 24000);
    feed.push(1, chunk(1800));
    expect(types()).toEqual(['begin', 'chunk']);
  });

  it('sends `end` only after every pending chunk has gone out', () => {
    const { feed, types } = setup(2000);
    feed.begin(1, 24000);
    feed.push(1, chunk(1000));
    feed.push(1, chunk(1000));
    feed.end(1);
    expect(types()).toEqual(['begin', 'chunk']);
    feed.onBuffered(100);
    expect(types()).toEqual(['begin', 'chunk', 'chunk', 'end']);
  });

  it('sends `end` once', () => {
    const { feed, types } = setup();
    feed.begin(1, 24000);
    feed.end(1);
    feed.onBuffered(0);
    feed.end(1);
    expect(types().filter((t) => t === 'end')).toHaveLength(1);
  });

  it('ignores chunks and ends from other turns', () => {
    const { feed, types } = setup();
    feed.begin(2, 24000);
    feed.push(1, chunk(100));
    feed.end(1);
    expect(types()).toEqual(['begin']);
  });

  it('drops everything pending on flush and tells the worklet', () => {
    const { feed, types } = setup(2000);
    feed.begin(1, 24000);
    feed.push(1, chunk(1000));
    feed.push(1, chunk(1000));
    feed.flush();
    feed.onBuffered(0);
    feed.push(1, chunk(100)); // stale after the flush
    expect(types()).toEqual(['begin', 'chunk', 'flush']);
    expect(feed.pendingMs).toBe(0);
    expect(feed.activeTurn).toBe(-1);
  });

  it('starts clean when a different turn begins', () => {
    const { feed, types } = setup(2000);
    feed.begin(1, 24000);
    feed.push(1, chunk(1000));
    feed.push(1, chunk(1000));
    feed.begin(2, 24000);
    feed.onBuffered(0);
    expect(types()).toEqual(['begin', 'chunk', 'begin']);
  });
});
