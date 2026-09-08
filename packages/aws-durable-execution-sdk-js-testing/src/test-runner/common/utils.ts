// Reviewed `@typescript-eslint/no-unnecessary-type-parameters` disable before the migration -- no Biome equivalent (see biome.jsonc gap 1). ResultType appears once but is deliberate: it lets a caller name the expected parse shape, which this helper then asserts on the return.
export function tryJsonParse<ResultType>(
  obj: string | undefined,
): ResultType | undefined {
  if (obj === undefined) {
    return obj;
  }

  try {
    return JSON.parse(obj) as unknown as ResultType;
  } catch {
    return obj as ResultType;
  }
}
