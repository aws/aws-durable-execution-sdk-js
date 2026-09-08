// TypeScript 6.0 turns `noUncheckedSideEffectImports` on by default, so a
// side-effect import with no declaration is an error rather than silently ignored.
// The stylesheet imports here are resolved by esbuild at bundle time, not by
// TypeScript, so they need declaring for the checker's benefit.
//
// Declared narrowly (stylesheets only) on purpose: the point of the new default is
// to catch typos in side-effect imports, and turning the flag off in tsconfig would
// give that up for every import in the package rather than just these.
declare module "*.css";
declare module "*.scss";
