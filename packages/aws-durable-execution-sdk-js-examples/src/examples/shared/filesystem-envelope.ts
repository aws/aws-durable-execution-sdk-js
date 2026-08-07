/**
 * The checkpoint envelope written by `createFileSystemSerdes`, as the serdes
 * examples observe it.
 *
 * The SDK's own shape is a discriminated union:
 *
 * ```ts
 * { data: string } | { file: string; preview?: Record<string, unknown> }
 * ```
 *
 * Exactly one of `data` or `file` is present:
 * - `data` — the serialized value inline, when OVERFLOW mode kept it under the
 *   threshold.
 * - `file` — a pointer to the file the value was written to.
 *
 * `preview` only ever accompanies `file`. `generatePreview` is invoked solely on
 * the write-to-file branches, so an inline `{ data }` envelope never carries one.
 *
 * That union is `@internal` and not exported, so it cannot be imported here. It
 * is mirrored as optional fields rather than a union because the tests assert a
 * field's *absence* — `expect(envelope.data).toBeUndefined()` alongside
 * `expect(typeof envelope.file).toBe("string")` — which a union would require
 * narrowing before either access. The cost is that mutual exclusivity is
 * documented here rather than enforced by the type, and that reads of `file`
 * need a non-null assertion.
 */
export interface FileSystemEnvelope {
  data?: string;
  file?: string;
  preview?: Record<string, unknown>;
}
