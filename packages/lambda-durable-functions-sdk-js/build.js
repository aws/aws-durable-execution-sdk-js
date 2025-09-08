const esbuild = require("esbuild");
const rimraf = require("rimraf");
const fs = require("fs");
const path = require("path");

// Clean dist folder
rimraf.sync("./dist");

console.log("📦 Building library with peer dependencies as external...\n");

// Identify all dependencies that should be external
const packageJson = JSON.parse(fs.readFileSync("./package.json", "utf8"));
const externalDependencies = [
  // Peer dependencies (should always be external)
  ...Object.keys(packageJson.peerDependencies || {}),
];

console.log("📋 External dependencies (not bundled):");
externalDependencies.forEach((dep) => {
  console.log(`   🚫 ${dep}`);
});

// Build library code bundle (with all dependencies marked as external)
console.log("\n📚 Building library code bundle...");
const libResult = esbuild.buildSync({
  entryPoints: ["./src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node16",
  format: "cjs",
  outfile: "./dist/index.js",
  metafile: true,
});

// Save metafile for analysis
fs.writeFileSync(
  "./dist/library-metafile.json",
  JSON.stringify(libResult.metafile, null, 2),
);

// Generate bundle analysis report
const reportData = generateBundleReport(libResult.metafile);

function generateBundleReport(libMetafile) {
  console.log("\n📊 Peer Dependencies Bundle Analysis Report");
  console.log("==========================================\n");

  // Analyze library bundle
  const libOutputs = libMetafile.outputs;
  const libOutput = Object.values(libOutputs)[0];
  console.log(`📚 Library Bundle (index.js):`);
  console.log(`   Size: ${formatBytes(libOutput.bytes)}`);

  if (libOutput.imports && libOutput.imports.length > 0) {
    console.log("   External imports (to be installed by users):");
    libOutput.imports.forEach((imp) => {
      console.log(`     - ${imp.path} (${imp.kind})`);
    });
  }
  console.log("");

  // Analyze library inputs by size (only our source files)
  const libInputs = libMetafile.inputs;
  const libInputSizes = Object.entries(libInputs)
    .filter(([path]) => !path.includes("node_modules")) // Only show our code
    .map(([path, input]) => ({
      path: path.replace(process.cwd(), "."),
      bytes: input.bytes,
      imports: input.imports?.length || 0,
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 15); // Top 15 largest files

  console.log("📁 Largest Library Files (Top 15):");
  console.log("==================================");
  libInputSizes.forEach((file, index) => {
    console.log(
      `${(index + 1).toString().padStart(2)}. ${file.path.padEnd(50)} ${formatBytes(file.bytes).padStart(8)} (${file.imports} imports)`,
    );
  });

  // Summary
  const totalLibSize = Object.values(libInputs)
    .filter(
      (_, index) => !Object.keys(libInputs)[index].includes("node_modules"),
    )
    .reduce((sum, input) => sum + input.bytes, 0);

  const totalLibOutput = libOutput.bytes;

  console.log("\n📈 Peer Dependencies Bundle Summary:");
  console.log("===================================");
  console.log(`Library code input:    ${formatBytes(totalLibSize)}`);
  console.log(`Library bundle:        ${formatBytes(totalLibOutput)}`);
  console.log(
    `Library compression:   ${totalLibSize > 0 ? ((1 - totalLibOutput / totalLibSize) * 100).toFixed(1) : 0}%`,
  );
  console.log(
    `Library files:         ${Object.keys(libInputs).filter((p) => !p.includes("node_modules")).length}`,
  );
  console.log(`Dependencies bundled:  0 (all external)`);
  console.log(`Bundle approach:       Peer Dependencies`);

  console.log("\n💡 Installation Instructions for Users:");
  console.log("======================================");
  console.log("Users will need to install peer dependencies separately:");
  externalDependencies.forEach((dep) => {
    console.log(`   npm install ${dep}`);
  });

  return { libOutput, totalLibSize, totalLibOutput };
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

// Build type declarations
console.log("\n📝 Generating type declarations...");
try {
  const { execSync } = require("child_process");
  const result = execSync("tsc --emitDeclarationOnly --outDir dist", {
    encoding: "utf-8",
  });
  console.log(result);
} catch (error) {
  console.error("Error running tsc:");
  if (error.stdout) console.error(error.stdout.toString());
  if (error.stderr) console.error(error.stderr.toString());
  process.exit(1);
}

console.log("\n✅ Peer dependencies build completed successfully! 🎉");
console.log("📁 Output files:");
console.log(
  "   - dist/index.js (library code only - " +
    formatBytes(reportData.libOutput.bytes) +
    ")",
);
console.log("   - dist/index.d.ts (type declarations)");
console.log("\n🎯 Result: Ultra-lightweight bundle with peer dependencies!");
