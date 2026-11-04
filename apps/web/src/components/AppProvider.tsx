'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ContextSync } from '@/lib/db/contextSync';
import { createRepo, type Repo } from '@/lib/db/repo';
import { getDb, type BolDb } from '@/lib/db/schema';
import { seedIfFirstRun } from '@/lib/db/seed';
import { getGatewayUrl } from '@/lib/env';
import { ToneMic } from '@/lib/dev/toneMic';
import { createRealtimeSession, type RealtimeSession } from '@/lib/session/createSession';
import { hydrateSettings, settingsStore } from '@/lib/settings';
import { attachHandsFree } from '@/lib/voice/handsFree';
import { saveDraft } from '@/lib/voice/saveDraft';

export interface Toast {
  id: number;
  message: string;
  kind: 'ok' | 'error' | 'info';
}

interface AppContext {
  db: BolDb | null;
  repo: Repo | null;
  /** Null until the browser has set the database up (and always on the server). */
  session: RealtimeSession | null;
  /** Why local data could not be opened (blocked storage), if it could not. */
  dataError: string | null;
  toast(message: string, kind?: Toast['kind']): void;
}

const Ctx = createContext<AppContext>({ db: null, repo: null, session: null, dataError: null, toast: () => undefined });

export const useApp = () => useContext(Ctx);

/**
 * Owns the long-lived pieces so they survive moving between screens: the local database, the
 * gateway session (connection, microphone, playback, turn state) and the catalog sync.
 */
export function AppProvider({ children }: { children: ReactNode }) {
  const [parts, setParts] = useState<Pick<AppContext, 'db' | 'repo' | 'session' | 'dataError'>>({
    db: null,
    repo: null,
    session: null,
    dataError: null,
  });
  const [synthetic, setSynthetic] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextToast = useRef(1);

  const toast = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    const id = nextToast.current++;
    setToasts((list) => [...list.slice(-2), { id, message, kind }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3500);
  }, []);

  useEffect(() => {
    hydrateSettings();
    let disposed = false;
    const cleanups: (() => void)[] = [];

    (async () => {
      let db: BolDb;
      try {
        db = getDb();
        await seedIfFirstRun(db);
      } catch {
        if (!disposed) setParts((p) => ({ ...p, dataError: 'Is browser mein data save nahi ho sakta. Local storage is blocked.' }));
        return;
      }
      if (disposed) return;
      const repo = createRepo(db);
      const holder: { session?: RealtimeSession } = {};
      // Development only: `?tone=1` swaps the microphone for a labelled synthetic tone, for machines with no mic.
      const tone = process.env.NODE_ENV !== 'production' && new URLSearchParams(location.search).get('tone') === '1';
      setSynthetic(tone);
      const sync = new ContextSync({ db, send: (m) => holder.session?.client.send(m) ?? false });
      const session = createRealtimeSession({
        gatewayUrl: getGatewayUrl(),
        getCatalog: () => sync.snapshotForHello(),
        micSettings: settingsStore.getState().mic,
        ...(tone ? { createMic: (onFrame: (frame: ArrayBuffer) => void) => new ToneMic(onFrame) } : {}),
        handlers: {
          saveDraft: (draft) => {
            void saveDraft(repo, draft).then((outcome) => {
              if (outcome.kind === 'error') toast(outcome.message, 'error');
              else if (outcome.created) toast(outcome.kind === 'bill' ? 'Bill save ho gaya' : 'Payment likh liya', 'ok');
            });
          },
        },
      });
      holder.session = session;
      sync.start();
      cleanups.push(
        () => sync.stop(),
        () => session.dispose(),
        attachHandsFree(session.controller, () => settingsStore.getState().handsFree),
      );
      let lastMic = JSON.stringify(settingsStore.getState().mic);
      cleanups.push(
        settingsStore.subscribe((s) => {
          const next = JSON.stringify(s.mic);
          if (next === lastMic) return;
          lastMic = next;
          void session.mic.updateSettings?.(s.mic);
        }),
      );
      setParts({ db, repo, session, dataError: null });
    })();

    return () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
    };
  }, [toast]);

  const value = useMemo<AppContext>(() => ({ ...parts, toast }), [parts, toast]);
  return (
    <Ctx.Provider value={value}>
      {synthetic && (
        <p className="fixed inset-x-0 top-0 z-50 bg-amber-400 px-3 py-1 text-center text-sm font-bold text-stone-950">
          SYNTHETIC TEST TONE (dev only): not a real voice
        </p>
      )}
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rise pointer-events-auto rounded-xl px-4 py-3 text-base font-semibold shadow-lg ${
              t.kind === 'ok' ? 'bg-emerald-500 text-stone-950' : t.kind === 'error' ? 'bg-red-500 text-white' : 'bg-stone-100 text-stone-950'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
