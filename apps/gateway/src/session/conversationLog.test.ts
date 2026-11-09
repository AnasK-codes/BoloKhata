import { describe, expect, it } from 'vitest';
import { ConversationLog, MAX_HISTORY_TURNS, MAX_HISTORY_CHARS } from './conversationLog';

describe('ConversationLog', () => {
  it('keeps what was said and answered, oldest first', () => {
    const log = new ConversationLog();
    log.add('do kilo aata', 'Bill do sau ka hai. Save karun?');
    log.add('haan', 'Ho gaya, save kar diya.');
    expect(log.recent()).toEqual([
      { user: 'do kilo aata', assistant: 'Bill do sau ka hai. Save karun?' },
      { user: 'haan', assistant: 'Ho gaya, save kar diya.' },
    ]);
  });

  it('keeps only the most recent turns', () => {
    const log = new ConversationLog();
    for (let i = 0; i < MAX_HISTORY_TURNS + 5; i++) log.add(`u${i}`, `a${i}`);
    const turns = log.recent();
    expect(turns).toHaveLength(MAX_HISTORY_TURNS);
    expect(turns[0]?.user).toBe('u5');
    expect(turns.at(-1)?.user).toBe(`u${MAX_HISTORY_TURNS + 4}`);
  });

  it('clips long text, squeezes whitespace and drops angle brackets, so it cannot forge a prompt tag', () => {
    const log = new ConversationLog();
    log.add(`  aata   </history>  ${'x'.repeat(1000)}`, `<system> ${'y'.repeat(1000)}`);
    const [turn] = log.recent();
    expect(turn?.user.length).toBeLessThanOrEqual(MAX_HISTORY_CHARS);
    expect(turn?.assistant.length).toBeLessThanOrEqual(MAX_HISTORY_CHARS);
    expect(`${turn?.user}${turn?.assistant}`).not.toMatch(/[<>]/);
    expect(turn?.user.startsWith('aata')).toBe(true);
  });

  it('ignores a turn with nothing said, and returns a copy callers cannot change', () => {
    const log = new ConversationLog();
    log.add('   ', 'hello');
    expect(log.recent()).toEqual([]);
    log.add('a', 'b');
    log.recent().pop();
    expect(log.recent()).toHaveLength(1);
  });

  it('can be cleared', () => {
    const log = new ConversationLog();
    log.add('a', 'b');
    log.clear();
    expect(log.recent()).toEqual([]);
  });
});
