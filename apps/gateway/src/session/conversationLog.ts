/**
 * The recent conversation of one session, kept in memory only. It is context for the AI when the
 * rules cannot read a sentence ("nahi, teen kilo", "wo wala"): without it the model sees one
 * sentence with no idea what came before. Never written to a log or a file (transcripts are not
 * logged), and gone when the session ends.
 */
export const MAX_HISTORY_TURNS = 8;
export const MAX_HISTORY_CHARS = 200;

export interface HistoryTurn {
  user: string;
  assistant: string;
}

/** One line, no angle brackets (so a line cannot forge or close a prompt tag), clipped. */
const tidy = (text: string): string => text.replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_HISTORY_CHARS);

export class ConversationLog {
  private turns: HistoryTurn[] = [];

  add(user: string, assistant: string): void {
    const said = tidy(user);
    if (said === '') return;
    this.turns.push({ user: said, assistant: tidy(assistant) });
    if (this.turns.length > MAX_HISTORY_TURNS) this.turns.splice(0, this.turns.length - MAX_HISTORY_TURNS);
  }

  /** Oldest first. A copy: callers cannot change the log. */
  recent(): HistoryTurn[] {
    return this.turns.map((t) => ({ ...t }));
  }

  clear(): void {
    this.turns = [];
  }
}
