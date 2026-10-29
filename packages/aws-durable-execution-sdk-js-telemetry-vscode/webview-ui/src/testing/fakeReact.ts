/**
 * The few React hooks the viewer's state hooks use — useState, useRef,
 * useCallback, useEffect — run synchronously outside a DOM, so a hook's state
 * machine can be tested with node:test. test.mjs swaps this module in for
 * "react" only when bundling `*.hook.test.ts` files.
 *
 * It re-renders right after each setState, then runs the effects whose
 * dependencies changed. Intervals are recorded rather than scheduled; call
 * `tick()` to fire them.
 */
type Effect = { deps?: unknown[]; cleanup?: (() => void) | undefined };

let states: unknown[] = [];
let refs: { current: unknown }[] = [];
let effects: Effect[] = [];
let callbacks: { fn: unknown; deps?: unknown[] }[] = [];
let si = 0;
let ri = 0;
let ei = 0;
let ci = 0;
let pendingEffects: (() => void)[] = [];
let rerender: (() => void) | null = null;
let rendering = false;
let dirty = false;

const sameDeps = (a?: unknown[], b?: unknown[]) =>
  !!a && !!b && a.length === b.length && a.every((d, k) => Object.is(d, b[k]));

export function useState<T>(init: T | (() => T)) {
  const i = si++;
  if (!(i in states)) {
    states[i] = typeof init === "function" ? (init as () => T)() : init;
  }
  const set = (v: T | ((p: T) => T)) => {
    states[i] =
      typeof v === "function" ? (v as (p: T) => T)(states[i] as T) : v;
    if (rendering) dirty = true;
    else rerender?.();
  };
  return [states[i] as T, set] as const;
}

export function useRef<T>(init: T) {
  const i = ri++;
  refs[i] ??= { current: init };
  return refs[i] as { current: T };
}

export function useCallback<T>(fn: T, deps?: unknown[]): T {
  const i = ci++;
  const prev = callbacks[i];
  if (prev && sameDeps(deps, prev.deps)) return prev.fn as T;
  callbacks[i] = { fn, deps };
  return fn;
}

export function useEffect(
  fn: () => (() => void) | undefined,
  deps?: unknown[],
) {
  const i = ei++;
  const prev = effects[i];
  if (prev && sameDeps(deps, prev.deps)) return;
  pendingEffects.push(() => {
    if (typeof prev?.cleanup === "function") prev.cleanup();
    effects[i] = { deps, cleanup: fn() ?? undefined };
  });
  effects[i] ??= { deps: undefined };
}

/** Intervals set by the hook, by id. */
export const intervals = new Map<number, () => void>();
let nextTimer = 1;
const g = globalThis as unknown as {
  setInterval: (fn: () => void) => number;
  clearInterval: (id: number) => void;
};
g.setInterval = (fn: () => void) => {
  const id = nextTimer++;
  intervals.set(id, fn);
  return id;
};
g.clearInterval = (id: number) => {
  intervals.delete(id);
};

/** Fires every interval once. */
export function tick(): void {
  for (const fn of [...intervals.values()]) fn();
}

/** Renders `hook` and returns a getter for its latest result. */
export function mount<R>(hook: () => R): { get: () => R } {
  states = [];
  refs = [];
  effects = [];
  callbacks = [];
  intervals.clear();
  let result!: R;
  rerender = () => {
    do {
      dirty = false;
      si = ri = ei = ci = 0;
      pendingEffects = [];
      rendering = true;
      result = hook();
      rendering = false;
      const run = pendingEffects;
      pendingEffects = [];
      for (const e of run) e();
    } while (dirty);
  };
  rerender();
  return { get: () => result };
}

export default { useState, useRef, useCallback, useEffect };
