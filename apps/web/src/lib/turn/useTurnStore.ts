import { useStore } from 'zustand';
import type { TurnStore, TurnStoreState } from './store';

/** React binding: re-renders only when the selected slice changes. */
export function useTurnStore<T>(store: TurnStore, selector: (state: TurnStoreState) => T): T {
  return useStore(store, selector);
}
