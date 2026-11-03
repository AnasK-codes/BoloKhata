import { getGatewayUrl } from '@/lib/env';

export default function HomePage() {
  const gatewayUrl = getGatewayUrl();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-between px-4 py-8">
      <header className="w-full text-center">
        <h1 className="text-3xl font-bold tracking-tight">Bol-Bill</h1>
        <p className="mt-2 text-base text-stone-300">Bolkar bill banao. Speak, and the bill is ready.</p>
      </header>

      <section className="flex flex-col items-center gap-4">
        <button
          type="button"
          disabled
          aria-label="Microphone (coming soon)"
          className="flex h-28 w-28 items-center justify-center rounded-full bg-amber-500 text-4xl text-stone-950 opacity-40"
        >
          <span aria-hidden="true">🎤</span>
        </button>
        <p className="text-sm text-stone-400">Mic jald aa raha hai. The mic arrives in a later step.</p>
      </section>

      <footer className="w-full text-center text-xs text-stone-500">
        Gateway: <code>{gatewayUrl}</code>
      </footer>
    </main>
  );
}
