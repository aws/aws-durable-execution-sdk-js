import { DAR_VERSION, OLDEST_DAR_VERSION } from "./version";

/** Upgrades a raw `.dar` object from one `darVersion` to the next. */
export type DarMigration = (
  raw: Record<string, unknown>,
) => Record<string, unknown>;

/**
 * Registered migrations keyed by the `darVersion` they upgrade **from**. Empty
 * today (the format has only ever been "1.0"); when the schema changes, bump
 * {@link DAR_VERSION} and register a migration here from the previous version.
 */
const MIGRATIONS: Record<string, DarMigration> = {};

/**
 * Brings a raw parsed `.dar` object up to {@link DAR_VERSION} by applying the
 * registered migrations in sequence. A missing/blank `darVersion` is treated as
 * current (matching historical behavior); an unknown/newer version with no
 * migration path is returned untouched (the caller may still parse it).
 *
 * Pure and side-effect free (operates on a shallow copy). `migrations` is
 * injectable for testing.
 */
export function migrateDar(
  raw: unknown,
  migrations: Record<string, DarMigration> = MIGRATIONS,
): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Not a .dar workflow: expected a JSON object.");
  }
  let obj: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  // An unversioned file is a LEGACY file, so it must be treated as the oldest
  // version — not as the current one. Defaulting to DAR_VERSION meant that the
  // first time a 1.0 -> 2.0 migration is registered, every unversioned legacy file
  // would silently skip it and be read as though it were already current. The
  // default has to be a fixed literal, not the moving target.
  /**
   * Canonicalizes a version so equivalent spellings compare equal: "1" and "1.0"
   * are the same format, and real files in the wild carry both. Without this, a
   * strict check rejects files it can read perfectly well — a worse failure than the
   * silent pass-through it replaced.
   */
  const canon = (v: string): string => {
    // Compared on MAJOR.MINOR only. Nothing writes a three-component version today,
    // but "1.0.0" is unambiguously the same format as "1.0", and rejecting it would
    // fail a file we can read perfectly well — the same over-strictness that made the
    // first version of this check reject "1".
    const parts = v.trim().split(".");
    while (parts.length < 2) parts.push("0");
    return parts
      .slice(0, 2)
      .map((n) => String(Number(n) || 0))
      .join(".");
  };
  let version =
    typeof obj.darVersion === "string" && obj.darVersion.length > 0
      ? obj.darVersion
      : OLDEST_DAR_VERSION;
  const seen = new Set<string>();
  while (
    canon(version) !== canon(DAR_VERSION) &&
    migrations[version] &&
    !seen.has(version)
  ) {
    seen.add(version); // guard against a migration that doesn't advance
    obj = migrations[version](obj);
    version = typeof obj.darVersion === "string" ? obj.darVersion : DAR_VERSION;
  }
  // A version we have no path from is either from a newer writer or corrupt. Both
  // used to be returned untouched and silently treated as current, which turns a
  // forward-compatibility problem into wrong behaviour with no signal.
  if (canon(version) !== canon(DAR_VERSION)) {
    throw new Error(
      `Cannot read this .dar workflow: it declares version "${version}" and this ` +
        `build knows how to read "${DAR_VERSION}" (with migrations from ` +
        `${Object.keys(migrations).sort().join(", ") || "none"}). It was probably ` +
        `written by a newer version — upgrade, or open it there.`,
    );
  }
  return obj;
}
