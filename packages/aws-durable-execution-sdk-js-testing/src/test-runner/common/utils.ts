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
