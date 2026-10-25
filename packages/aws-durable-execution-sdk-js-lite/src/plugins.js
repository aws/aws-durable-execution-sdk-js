// Plugins (README 2.12). withDurableExecution calls createPlugins once per invocation,
// and only when the config has plugins. So an invocation without plugins runs none of
// this code.

// Calls every factory and collects the hooks. Each hook is undefined when no plugin has
// it. So a call point checks one variable and allocates nothing without the hook.
export function createPlugins(factories, info) {
  const plugins = factories.map((factory) => factory(info)).filter(Boolean);
  const changes = plugins.filter((p) => p.onOperationChange);
  const wraps = plugins.filter((p) => p.wrap);
  const ends = plugins.filter((p) => p.onInvocationEnd);
  return {
    onOperationChange:
      changes.length === 0
        ? undefined
        : (change) => {
            for (const p of changes) p.onOperationChange(change);
          },
    // The first plugin's wrap is the outermost. reduceRight builds the chain once, from
    // the innermost call, which is the original fn.
    wrap:
      wraps.length === 0
        ? undefined
        : wraps.reduceRight(
            (inner, p) => (w) => p.wrap({ ...w, fn: () => inner(w) }),
            (w) => w.fn(),
          ),
    // The hooks run in parallel. A rejection makes the handler throw (README 1.2).
    onInvocationEnd: async (end) => {
      await Promise.all(ends.map((p) => p.onInvocationEnd(end)));
    },
  };
}

// The argument of wrap for a context or an attempt. ctx._base gives the hashed Id and
// ParentId that the operation's record has.
export function wrapInfo(
  ctx,
  rawId,
  { type, subType, name },
  kind,
  attempt,
  fn,
) {
  const { Id, ParentId } = ctx._base(rawId, { type });
  return { kind, id: Id, parentId: ParentId, name, type, subType, attempt, fn };
}
