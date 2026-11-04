import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';

export interface Live<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | undefined;
}

/**
 * Re-renders with fresh data whenever the tables a query reads change. `query` may be a new
 * function each render; pass `deps` to say when it should be re-subscribed. Returns
 * `loading: true` until the first result, which is also what server rendering sees.
 */
export function useLive<T>(query: (() => Promise<T>) | null, deps: readonly unknown[]): Live<T> {
  const [state, setState] = useState<Live<T>>({ data: undefined, loading: true, error: undefined });
  useEffect(() => {
    if (query === null) return;
    setState((s) => ({ ...s, loading: true }));
    const subscription = liveQuery(query).subscribe({
      next: (data) => setState({ data, loading: false, error: undefined }),
      error: (error: unknown) =>
        setState({ data: undefined, loading: false, error: error instanceof Error ? error : new Error('Database error') }),
    });
    return () => subscription.unsubscribe();
  }, deps);
  return state;
}
