'use client';

import { useEffect, useRef } from 'react';
import { Icon } from '../Icon';
import { useT } from '@/lib/i18n';
import type { ChatEntry } from '@/lib/turn/types';

/** One exchange as two bubbles: what was said, then the answer. */
export function ChatBubbles({ entry }: { entry: ChatEntry }) {
  const t = useT();
  return (
    <li className="chat-pair">
      <p className="chat-me"><span className="sr-only">{t('history.you')}: </span>&ldquo;{entry.user}&rdquo;</p>
      {entry.assistant !== undefined && (
        <p className="chat-bot"><span className="sr-only">{t('history.assistant')}: </span>{entry.assistant}</p>
      )}
    </li>
  );
}

/** The whole conversation of this session, newest at the bottom, in a bottom sheet. */
export function ConversationSheet({ entries, onClear, onClose }: { entries: readonly ChatEntry[]; onClear(): void; onClose(): void }) {
  const t = useT();
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Start at the latest exchange.
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [entries.length]);
  return (
    <div className="sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="history-title">
        <div className="sheet-grabber" aria-hidden="true" />
        <div className="flex items-center justify-between gap-3">
          <h2 id="history-title" className="text-xl font-semibold tracking-tight">{t('history.title')}</h2>
          <div className="flex items-center gap-2">
            {entries.length > 0 && <button type="button" className="btn-pill btn-soft" onClick={onClear}>{t('history.clear')}</button>}
            <button type="button" className="vs-icon-btn" aria-label={t('history.close')} onClick={onClose} autoFocus><Icon name="close" size={20} /></button>
          </div>
        </div>
        <p className="mt-1 text-sm text-muted">{t('history.hint')}</p>
        <div ref={list} className="chat-scroll" tabIndex={0} role="region" aria-label={t('history.title')}>
          {entries.length === 0
            ? <p className="chat-empty">{t('history.empty')}</p>
            : <ol className="chat-list">{entries.map((e) => <ChatBubbles key={e.turnId} entry={e} />)}</ol>}
        </div>
        {entries.length > 0 && <p className="mt-2 text-xs text-muted">{t('history.clearHint')}</p>}
      </div>
    </div>
  );
}
