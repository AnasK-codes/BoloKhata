'use client';

import { useEffect, useState } from 'react';

/**
 * Registers the service worker (production builds only: in development a cache-first shell
 * would hide code changes) and offers an "Update available" toast when a new version has
 * installed and is waiting.
 */
export function PwaRegister() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };

    navigator.serviceWorker.register('/sw.js').then((registration) => {
      if (registration.waiting && navigator.serviceWorker.controller) setWaiting(registration.waiting);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) setWaiting(worker);
        });
      });
      // Check for a new version when the app comes back to the foreground.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update().catch(() => undefined);
      });
    }).catch(() => undefined); // no service worker: the app still works online
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, []);

  if (!waiting) return null;
  return (
    <div role="status" className="rise fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl bg-raised px-4 py-3 text-ink shadow-xl">
      <span className="font-semibold">Naya version aaya hai</span>
      <button type="button" className="min-h-12 rounded-xl bg-accent px-4 font-bold text-on-solid" onClick={() => waiting.postMessage({ type: 'SKIP_WAITING' })}>
        Update karo
      </button>
    </div>
  );
}
