/** Current `.dar` schema version. Bump when introducing a migration. */
export const DAR_VERSION = "1.0";

/**
 * The oldest format version, used as the assumed version of a file that carries no
 * `darVersion` at all.
 *
 * Deliberately a FIXED literal that must never track {@link DAR_VERSION}: an
 * unversioned file is a legacy file, so defaulting it to whatever the current
 * version happens to be would make every future migration silently skip it.
 */
export const OLDEST_DAR_VERSION = "1.0";
