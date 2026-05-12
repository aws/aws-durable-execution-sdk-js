/**
 * Controls whether a preview field is matched by name anywhere in the object
 * tree, or by exact dot-notation path from the root.
 *
 * @public
 */
export enum FieldMatchMode {
  /** Match the field name at any depth in the object tree (default). */
  ANYWHERE = "ANYWHERE",
  /**
   * Match by exact dot-notation path from root.
   * A single segment (e.g. `"email"`) matches only the root-level field.
   * A dotted path (e.g. `"user.email"`) matches that exact nested location.
   */
  PATH = "PATH",
}

/**
 * Controls which fields are included in the preview by default.
 *
 * @public
 */
export enum PreviewMode {
  /** Include all fields, then apply `exclude` and `mask` rules. */
  INCLUDE_ALL = "INCLUDE_ALL",
  /** Exclude all fields, then apply `include` and `mask` rules. */
  EXCLUDE_ALL = "EXCLUDE_ALL",
}

/**
 * A field selector used in preview include/exclude/mask lists.
 *
 * @public
 */
export interface PreviewField {
  /** Field name or dot-notation path. */
  name: string;
  /** How to match the field. Defaults to `FieldMatchMode.ANYWHERE`. */
  match?: FieldMatchMode;
}

/**
 * Configuration for {@link buildPreview}.
 *
 * @public
 */
export interface PreviewConfig {
  /** Whether to start with all fields included or all excluded. */
  mode: PreviewMode;
  /** Fields to include (used with `EXCLUDE_ALL` mode, or to override `INCLUDE_ALL`). */
  include?: PreviewField[];
  /** Fields to exclude (used with `INCLUDE_ALL` mode, or to override `EXCLUDE_ALL`). */
  exclude?: PreviewField[];
  /** Fields to mask — if visible, their value is replaced with `maskString`. */
  mask?: PreviewField[];
  /**
   * String used to replace masked field values.
   * @defaultValue `"***"`
   */
  maskString?: string;
  /**
   * Maximum size in bytes for the preview object (JSON-serialized).
   * Fields are added until this limit is reached.
   * @defaultValue `4096`
   */
  maxPreviewBytes?: number;
}

/** Returns true if the field at `path` (dot-notation) matches the given PreviewField rule. */
function fieldMatches(path: string, field: PreviewField): boolean {
  const mode = field.match ?? FieldMatchMode.ANYWHERE;
  if (mode === FieldMatchMode.PATH) {
    return path === field.name;
  }
  return path.split(".").includes(field.name);
}

function isMatched(path: string, fields: PreviewField[] | undefined): boolean {
  return fields?.some((f) => fieldMatches(path, f)) ?? false;
}

/**
 * Builds a preview object from `value` according to `config`.
 *
 * Traverses the object tree and collects fields based on the include/exclude/mask
 * rules in `config`. The result is a nested object mirroring the original structure,
 * capped at `config.maxPreviewBytes` (default 4096 bytes).
 *
 * Priority rules:
 * - `exclude` always wins — excluded fields are never shown, even if in `mask`
 * - `mask` implies visibility — masked fields are shown (with `maskString`) unless excluded
 *
 * Limitations:
 * - Field names containing dots are not supported (indistinguishable from path separators)
 * - Array structure is not preserved — fields from array elements are merged into a plain object
 * - When array elements have heterogeneous shapes at the same field path, later elements
 *   overwrite earlier primitives in the preview (e.g. `[{ user: "arb" }, { user: { email: "x" } }]`
 *   produces `{ user: { email: "x" } }` — `"arb"` is lost)
 *
 * @example
 * ```typescript
 * const preview = buildPreview(order, {
 *   mode: PreviewMode.EXCLUDE_ALL,
 *   include: [{ name: "id" }, { name: "status" }],
 *   mask: [{ name: "email" }],
 * });
 * // { id: "order-123", status: "pending", user: { email: "***" } }
 * ```
 *
 * @public
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildPreview(
  value: any,
  config: PreviewConfig,
): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object") return undefined;

  const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
  const maskString = config.maskString ?? "***";
  const maxBytes = config.maxPreviewBytes ?? 4096;

  const pairs: Array<[string, unknown]> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function collect(obj: any, pathPrefix: string): void {
    if (obj === null || typeof obj !== "object") return;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        collect(item, pathPrefix);
      }
      return;
    }

    for (const key of Object.keys(obj)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      if (key.includes(".")) continue;
      const path = pathPrefix ? `${pathPrefix}.${key}` : key;
      const masked = isMatched(path, config.mask);
      const excluded = isMatched(path, config.exclude);
      const visible =
        !excluded &&
        (masked ||
          (config.mode === PreviewMode.INCLUDE_ALL
            ? true
            : isMatched(path, config.include)));

      if (!visible) {
        collect(obj[key], path);
        continue;
      }

      if (masked) {
        pairs.push([path, maskString]);
        continue;
      }

      if (obj[key] !== null && typeof obj[key] === "object") {
        collect(obj[key], path);
      } else {
        pairs.push([path, obj[key]]);
      }
    }
  }

  collect(value, "");
  if (pairs.length === 0) return undefined;

  const accepted: Array<[string, unknown]> = [];
  let estimatedSize = 2; // "{}"
  for (const [path, val] of pairs) {
    const entrySize = Buffer.byteLength(
      `"${path}":${JSON.stringify(val)},`,
      "utf-8",
    );
    if (estimatedSize + entrySize > maxBytes) break;
    accepted.push([path, val]);
    estimatedSize += entrySize;
  }

  if (accepted.length === 0) return undefined;

  const result: Record<string, unknown> = {};
  for (const [path, val] of accepted) {
    const parts = path.split(".");
    let node = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof node[parts[i]] !== "object" || node[parts[i]] === null) {
        node[parts[i]] = {};
      }
      node = node[parts[i]] as Record<string, unknown>;
    }
    node[parts[parts.length - 1]] = val;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}
