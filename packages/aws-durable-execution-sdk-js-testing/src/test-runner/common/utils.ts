// Intentionally casting the result for better DX
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function tryJsonParse<ResultType>(
  obj: string | undefined
): ResultType | undefined {
  if (obj === undefined) {
    return obj;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return JSON.parse(obj) as unknown as ResultType;
  } catch {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return obj as ResultType;
  }
}
