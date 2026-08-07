/**
 * The checkpoint envelope written by {@link createFileSystemSerdes}.
 *
 * Exactly one of `data` or `file` is present:
 * - `data` — the serialized value inline, when OVERFLOW mode kept it under the
 *   threshold.
 * - `file` — a pointer to the file the value was written to.
 *
 * `preview` is present alongside either when the serdes was given a
 * `generatePreview`, so the value stays visible in the console and API without
 * reading the file.
 *
 * Shared by the filesystem and preview serdes examples, which reach for the raw
 * envelope via `getStepDetails().result` to assert what the serdes actually
 * stored.
 */
export interface FileSystemEnvelope {
  data?: string;
  file?: string;
  preview?: Record<string, unknown>;
}
