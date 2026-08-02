import { type DarMigration, migrateDar } from "./migrate";
import { DAR_VERSION, OLDEST_DAR_VERSION } from "./version";

describe("migrateDar", () => {
  it("throws on non-objects", () => {
    expect(() => migrateDar(null)).toThrow(/expected a JSON object/);
    expect(() => migrateDar("x")).toThrow(/expected a JSON object/);
  });

  it("passes through a current-version workflow unchanged", () => {
    const wf = { darVersion: DAR_VERSION, name: "w", nodes: [], edges: [] };
    expect(migrateDar(wf)).toEqual(wf);
  });

  it("treats a missing darVersion as current (no-op)", () => {
    const wf = { name: "w", nodes: [] };
    expect(migrateDar(wf)).toEqual(wf);
  });

  it.each(["1", "1.0", "01.0", "1.0.0"])(
    "accepts %s as the current version, since those are the same format",
    (v) => {
      // Real files carry both spellings. Rejecting an equivalent spelling would be a
      // worse failure than the silent pass-through this replaced.
      expect(() => migrateDar({ darVersion: v, nodes: [] }, {})).not.toThrow();
    },
  );

  it("refuses a version it has no path from, rather than passing it through", () => {
    // Returning it untouched meant a file from a NEWER writer was read as though it
    // were current: a forward-compatibility problem silently becoming wrong
    // behaviour. Fail loudly instead.
    expect(() => migrateDar({ darVersion: "99.0", nodes: [] }, {})).toThrow(
      /declares version "99\.0"/,
    );
  });

  it("treats a file with no darVersion as the OLDEST version, not the current one", () => {
    // Defaulting to DAR_VERSION meant that the first time a 1.0 -> 2.0 migration is
    // registered, every unversioned legacy file would skip it silently. The default
    // must be a fixed literal, not the moving current version.
    const migrations: Record<string, DarMigration> = {
      [OLDEST_DAR_VERSION]: (o) => ({
        ...o,
        darVersion: DAR_VERSION,
        legacyMigrationRan: true,
      }),
    };
    // OLDEST === CURRENT today, so there is no gap to cross yet and an unversioned
    // file must simply be accepted. The property that matters is that the assumed
    // version is a FIXED literal, so it stops tracking DAR_VERSION the moment that
    // is bumped — which is exactly when the old default would have started skipping
    // migrations.
    expect(OLDEST_DAR_VERSION).toBe("1.0");
    expect(() => migrateDar({ nodes: [] }, migrations)).not.toThrow();
    // And the migration source is keyed off the oldest version, not the current one.
    expect(Object.keys(migrations)).toContain(OLDEST_DAR_VERSION);
  });

  it("applies registered migrations in sequence up to the current version", () => {
    const migrations: Record<string, DarMigration> = {
      "0.8": (o) => ({ ...o, darVersion: "0.9", eightRan: true }),
      "0.9": (o) => ({ ...o, darVersion: DAR_VERSION, nineRan: true }),
    };
    const out = migrateDar({ darVersion: "0.8", nodes: [] }, migrations);
    expect(out.darVersion).toBe(DAR_VERSION);
    expect(out.eightRan).toBe(true);
    expect(out.nineRan).toBe(true);
  });

  it("does not mutate the input", () => {
    const wf = { darVersion: "0.9", nodes: [] };
    migrateDar(wf, { "0.9": (o) => ({ ...o, darVersion: DAR_VERSION }) });
    expect(wf.darVersion).toBe("0.9");
  });
});

/**
 * The migration table is a plain object literal, so a bare `migrations[version]` lookup
 * resolves inherited Object.prototype members. A `.dar` declaring `darVersion: "valueOf"`
 * found Object.prototype.valueOf, "applied" it, and returned `{}` — the workflow silently
 * replaced by an empty object instead of the intended "cannot read" error. `.dar`
 * documents arrive from models, ASL imports and deployed functions, so that input is
 * reachable rather than theoretical.
 */
describe("migration lookup is own-property and canonical", () => {
  it.each(["valueOf", "toString", "hasOwnProperty", "constructor"])(
    "does not treat inherited %s as a registered migration",
    (name) => {
      expect(() => migrateDar({ darVersion: name, nodes: [1] }, {})).toThrow(
        /Cannot read this \.dar workflow/,
      );
    },
  );

  it("never returns a workflow stripped of its nodes", () => {
    // The failure mode that mattered: not an exception, but silent garbage.
    for (const name of ["valueOf", "toString"]) {
      let out: unknown;
      try {
        out = migrateDar({ darVersion: name, nodes: [1] }, {});
      } catch {
        out = undefined;
      }
      expect(out).toBeUndefined();
    }
  });

  it("matches a migration registered under an equivalent version spelling", () => {
    // Keyed on the canonical form, so a table of { "1.0": fn } also matches a file
    // declaring "1" — otherwise the documented "1" === "1.0" tolerance is defeated the
    // moment a migration is registered.
    const migrations: Record<string, DarMigration> = {
      "0.9": (o) => ({ ...o, darVersion: DAR_VERSION, ran: true }),
    };
    const out = migrateDar({ darVersion: "0.9.0", nodes: [] }, migrations);
    expect(out.ran).toBe(true);
  });
});
