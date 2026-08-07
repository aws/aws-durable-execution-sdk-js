import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions} */
const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: true,
  logLevel: "info",
  minify: !watch,
  // - electron: provided by the runtime shell, never bundled.
  // - node-llama-cpp: native, optional, and only reached through a dynamic
  //   import when the user picks the "local" LLM provider. Bundling it would
  //   make the app hard-depend on a native module most users never use.
  external: ["electron", "node-llama-cpp", "@node-llama-cpp/*"],
};

const builds = [
  { entryPoints: ["src/main.ts"], outfile: "dist/main.js" },
  { entryPoints: ["src/preload.ts"], outfile: "dist/preload.js" },
];

if (watch) {
  for (const b of builds) {
    const ctx = await esbuild.context({ ...common, ...b });
    await ctx.watch();
  }
  console.log("esbuild: watching...");
} else {
  for (const b of builds) {
    await esbuild.build({ ...common, ...b });
  }
  console.log("insight-desktop: built dist/main.js + dist/preload.js");
}
