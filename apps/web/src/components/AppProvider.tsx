'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getAccessCode } from '@/lib/accessCode';
import { ContextSync } from '@/lib/db/contextSync';
import { createRepo, type Repo } from '@/lib/db/repo';
import { getDb, type BolDb } from '@/lib/db/schema';
import { getGatewayUrl } from '@/lib/env';
import { createRealtimeSession, type RealtimeSession } from '@/lib/session/createSession';
import { hydrateSettings, settingsStore } from '@/lib/settings';
import { attachHandsFree } from '@/lib/voice/handsFree';
import { saveDraft, savedMessage } from '@/lib/voice/saveDraft';
import { receiptBusiness } from '@bolbill/shared';
import { useAccount } from './AccountGate';
import { t, useT } from '@/lib/i18n';

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
  const { user, profile } = useAccount();
  const profileRef = useRef(profile);
  useEffect(() => { profileRef.current = profile; }, [profile]);
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
        db = getDb(user.id);
        // Real accounts start empty. Synthetic demo data is available only through the explicit reset action.
        if (!(await db.meta.get('seededAt'))) await db.meta.put({ key: 'seededAt', value: Date.now() });
        // Ask the browser not to evict the ledger when storage is tight (iOS Safari is the main risk).
        void navigator.storage?.persist?.().catch(() => undefined);
      } catch {
        if (!disposed) setParts((p) => ({ ...p, dataError: t('common.storageBlocked') }));
        return;
      }
      if (disposed) return;
      const repo = createRepo(db, Date.now, () => crypto.randomUUID(), () => receiptBusiness(profileRef.current));
      const holder: { session?: RealtimeSession } = {};
      // Development only: `?tone=1` swaps the microphone for a labelled synthetic tone, for machines with no mic.
      const tone = process.env.NODE_ENV !== 'production' && new URLSearchParams(location.search).get('tone') === '1';
      setSynthetic(tone);
      // Loaded only in development with ?tone=1; the production build drops this branch and the module.
      const ToneMic = tone ? (await import('@/lib/dev/toneMic')).ToneMic : null;
      const sync = new ContextSync({ db, send: (m) => holder.session?.client.send(m) ?? false });
      const session = createRealtimeSession({
        gatewayUrl: getGatewayUrl(),
        sessionUrl: '/api/account/gateway-session',
        getCatalog: () => sync.snapshotForHello(),
        getDialect: () => settingsStore.getState().dialect,
        getAccessCode,
        micSettings: settingsStore.getState().mic,
        ...(ToneMic ? { createMic: (onFrame: (frame: ArrayBuffer) => void) => new ToneMic(onFrame) } : {}),
        handlers: {
          saveDraft: (draft) => {
            void saveDraft(repo, draft).then((outcome) => {
              if (outcome.kind === 'error') {
                // Keep a failed save reviewable so the user can fill details and retry.
                session.controller.editDraft(draft);
                toast(outcome.message, 'error');
              }
              else {
                const message = savedMessage(outcome);
                if (message) toast(message, 'ok');
              }
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
      let lastDialect = settingsStore.getState().dialect;
      cleanups.push(
        settingsStore.subscribe((s) => {
          if (s.dialect === lastDialect) return;
          lastDialect = s.dialect;
          // Version 0 carries no catalog change; the gateway applies the dialect regardless.
          session.client.send({ type: 'context_update', catalog: { version: 0 }, dialect: s.dialect });
        }),
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
  }, [toast, user.id]);

  const tr = useT();
  const value = useMemo<AppContext>(() => ({ ...parts, toast }), [parts, toast]);
  return (
    <Ctx.Provider value={value}>
      {synthetic && (
        <p className="relative z-50 bg-warn px-3 pb-1 pt-[max(4px,env(safe-area-inset-top))] text-center text-sm font-bold text-on-solid">
          {tr('dev.toneBanner')}
        </p>
      )}
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-[calc(10px+env(safe-area-inset-top))] z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast pointer-events-auto" data-kind={t.kind} role={t.kind === 'error' ? 'alert' : 'status'}>
            <span className="toast-ico" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d={t.kind === 'ok' ? 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z' : t.kind === 'error' ? 'M11 6h2v8h-2zm0 10h2v2h-2z' : 'M11 10h2v8h-2zm0-4h2v2h-2z'} /></svg>
            </span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
