import { createStore, type StoreApi } from 'zustand/vanilla';
import { reduce, initialTurnState } from './reducer';
import type { Effect, TurnEvent, TurnState } from './types';

export type TurnStoreState = TurnState & {
  /** The only way to change the state: run the event through the pure reducer, then run its effects. */
  dispatch(event: TurnEvent): void;
};

export type TurnStore = StoreApi<TurnStoreState>;

/**
 * Zustand holds the state; `reduce` decides every change. Effects run after the state is set,
 * so an effect that dispatches again (a failed send, say) sees the new state.
 */
export function createTurnStore(
  runEffects: (effects: Effect[]) => void,
  initial: Partial<TurnState> = {},
): TurnStore {
  return createStore<TurnStoreState>()((set, get) => ({
    ...initialTurnState(initial),
    dispatch(event) {
      const { dispatch: _dispatch, ...state } = get();
      const result = reduce(state, event);
      set(result.state);
      if (result.effects.length > 0) runEffects(result.effects);
    },
  }));
}
