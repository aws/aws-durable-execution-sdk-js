// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { AsyncLocalStorage, createHook } from "node:async_hooks";

// Observe only SDK timers/immediates. Fixture polling and AWS client pools have
// separate scopes, so an idle shared connection is not reported as an SDK leak.
export function observer(onActivity) {
  const scope = new AsyncLocalStorage();
  const resources = new Map();
  const hook = createHook({
    init(id, type, _trigger, resource) {
      const state = scope.getStore();
      if (state?.kind === "sdk" && ["Timeout", "Immediate"].includes(type)) {
        resources.set(id, { state, type, resource });
        onActivity?.(state);
      }
    },
    before(id) {
      const item = resources.get(id);
      if (item) onActivity?.(item.state);
      if (item?.state.closed) item.state.lateCallbacks++;
    },
    destroy(id) {
      resources.delete(id);
    },
  }).enable();
  return {
    scope,
    outside: (fn) => scope.run(undefined, fn),
    snapshot(state) {
      return {
        lateCallbacks: state.lateCallbacks,
        timers: [...resources.values()].filter(
          (item) => item.state === state && !item.resource._destroyed,
        ).length,
      };
    },
    close() {
      hook.disable();
      resources.clear();
    },
  };
}
