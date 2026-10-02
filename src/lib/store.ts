/**
 * Tiny external store with React bindings (replaces zustand).
 *
 *  - `set` merges a partial state; a patch that changes nothing (every key is
 *    `Object.is`-equal) does not notify, so redundant ticks cost nothing.
 *  - Components subscribe with a selector; React only re-renders when the
 *    selected value changes (`Object.is`, or a custom `equals`).
 *  - The state object is replaced on every effective update (immutable
 *    snapshots), which is what `useSyncExternalStore` requires.
 */
import { useRef, useSyncExternalStore } from "react";

export type SetState<T> = (patch: Partial<T> | ((s: T) => Partial<T>)) => void;
export type GetState<T> = () => T;

export interface StoreApi<T> {
  getState: GetState<T>;
  setState: SetState<T>;
  subscribe: (listener: (s: T, prev: T) => void) => () => void;
}

export interface UseStore<T> extends StoreApi<T> {
  (): T;
  <U>(selector: (s: T) => U, equals?: (a: U, b: U) => boolean): U;
}

export function createStore<T extends object>(init: (set: SetState<T>, get: GetState<T>) => T): UseStore<T> {
  let state: T;
  const listeners = new Set<(s: T, prev: T) => void>();
  const get: GetState<T> = () => state;
  const set: SetState<T> = (patch) => {
    const p = typeof patch === "function" ? patch(state) : patch;
    let changed = false;
    for (const k in p) {
      if (!Object.is((state as Record<string, unknown>)[k], (p as Record<string, unknown>)[k])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    const prev = state;
    state = { ...state, ...p };
    for (const l of [...listeners]) l(state, prev);
  };
  const subscribe = (l: (s: T, prev: T) => void) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  };
  state = init(set, get);
  const initial = state; // SSR + hydration must render from this, never from live (already ticking) state

  function useStore<U>(selector?: (s: T) => U, equals: (a: U, b: U) => boolean = Object.is): U {
    const sel = (selector ?? ((s: T) => s as unknown as U)) as (s: T) => U;
    // cache keyed on the state object: the selector runs once per state change, not once per call
    const cache = useRef<{ s: T; v: U; sel: (s: T) => U } | null>(null);
    const snap = () => {
      const c = cache.current;
      if (c && c.s === state && c.sel === sel) return c.v;
      const v = sel(state);
      if (c && equals(c.v, v)) {
        cache.current = { s: state, v: c.v, sel };
        return c.v;
      }
      cache.current = { s: state, v, sel };
      return v;
    };
    // getServerSnapshot must return a stable value: compute once per hook instance
    const serverCache = useRef<{ v: U } | null>(null);
    const serverSnap = () => (serverCache.current ??= { v: sel(initial) }).v;
    return useSyncExternalStore(subscribe, snap, serverSnap);
  }
  return Object.assign(useStore, { getState: get, setState: set, subscribe }) as UseStore<T>;
}
