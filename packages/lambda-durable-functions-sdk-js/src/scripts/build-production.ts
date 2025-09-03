import * as esbuild from "esbuild";
import * as rimraf from "rimraf";
import * as fs from "fs";
import { execSync } from "child_process";
import { processDirectory } from "./remove-logs";

/**
 * Production build script that removes log calls and creates optimized bundle with peer dependencies
 * This creates an ultra-lightweight bundle with all dependencies external
 */

interface PackageJson {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  [key: string]: any;
}

interface BuildMetafile {
  inputs: Record<
    string,
    {
      bytes: number;
      imports: Array<{
        path: string;
        kind: string;
        external?: boolean;
      }>;
    }
  >;
  outputs: Record<
    string,
    {
      bytes: number;
      inputs: Record<
        string,
        {
          bytesInOutput: number;
        }
      >;
    }
  >;
}

const TEMP_BUILD_DIR = "temp-build-src";
const DIST_DIR = "./dist";

function cleanDistFolder(): void {
  console.log("🧹 Cleaning dist folder...");
  if (fs.existsSync(DIST_DIR)) {
    rimraf.sync(DIST_DIR);
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

function createTempBuildDirectory(): void {
  console.log("📁 Creating temporary build directory...");
  if (fs.existsSync(TEMP_BUILD_DIR)) {
    rimraf.sync(TEMP_BUILD_DIR);
  }

  // Copy entire src directory to temp location
  execSync(`cp -r src ${TEMP_BUILD_DIR}`, { stdio: "pipe" });
}

function removeLogCalls(): void {
  console.log("🔧 Removing log function calls...");
  processDirectory(TEMP_BUILD_DIR);
}

function getExternalDependencies(): string[] {
  const packageJson: PackageJson = JSON.parse(
    fs.readFileSync("./package.json", "utf8"),
  );

  const externalDependencies = [
    // Runtime dependencies (if any)
    ...Object.keys(packageJson.dependencies || {}),
    // Peer dependencies (should always be external)
    ...Object.keys(packageJson.peerDependencies || {}),
    // Always external
    "aws-sdk",
  ];

  console.log("📋 External dependencies (not bundled):");
  externalDependencies.forEach((dep) => {
    console.log(`   🚫 ${dep}`);
  });

  return externalDependencies;
}

function buildLibraryBundle(
  externalDependencies: string[],
): esbuild.BuildResult {
  console.log("\n📚 Building optimized library code bundle...");

  const libResult = esbuild.buildSync({
    entryPoints: [`${TEMP_BUILD_DIR}/index.ts`],
    bundle: true,
    platform: "node",
    target: "node16",
    format: "cjs",
    outfile: `${DIST_DIR}/index.js`,
    external: externalDependencies,
    minify: true,
    sourcemap: false,
    treeShaking: true,
    metafile: true,
    logLevel: "silent",
  });

  // Save metafile for analysis
  fs.writeFileSync(
    `${DIST_DIR}/library-metafile.json`,
    JSON.stringify(libResult.metafile, null, 2),
  );

  return libResult;
}

function generateTypeDeclarations(): void {
  console.log("📝 Generating type declarations...");
  try {
    // Create a temporary tsconfig for the build that excludes scripts
    const tempTsConfig = {
      compilerOptions: {
        target: "ES2020",
        module: "CommonJS",
        lib: ["ES2020"],
        declaration: true,
        emitDeclarationOnly: true,
        outDir: "./dist",
        rootDir: TEMP_BUILD_DIR,
        strict: true,
        moduleResolution: "node",
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
      },
      include: [`${TEMP_BUILD_DIR}/**/*`],
      exclude: [
        "node_modules",
        "dist",
        `${TEMP_BUILD_DIR}/scripts/**/*`,
        "**/*.test.ts",
        "**/*.spec.ts",
      ],
    };

    fs.writeFileSync(
      "temp-tsconfig.json",
      JSON.stringify(tempTsConfig, null, 2),
    );

    execSync(`npx tsc --project temp-tsconfig.json`, {
      stdio: "pipe",
    });

    // Clean up temp config
    fs.unlinkSync("temp-tsconfig.json");
  } catch (error) {
    // Clean up temp config on error
    if (fs.existsSync("temp-tsconfig.json")) {
      fs.unlinkSync("temp-tsconfig.json");
    }
    console.error("❌ Error generating type declarations:");
    throw error;
  }
}

function analyzeBundle(metafile: BuildMetafile, bundleSize: number): void {
  console.log("\n📊 Production Peer Dependencies Bundle Analysis Report");
  console.log("=====================================================");

  // Analyze library bundle
  console.log("\n📚 Library Bundle (index.js):");
  console.log(`   Size: ${formatBytes(bundleSize)}`);

  // Show external imports
  const externalImports = new Set<string>();
  Object.values(metafile.inputs).forEach((input) => {
    input.imports?.forEach((imp) => {
      if (imp.external) {
        externalImports.add(`${imp.path} (${imp.kind})`);
      }
    });
  });

  if (externalImports.size > 0) {
    console.log("   External imports (to be installed by users):");
    externalImports.forEach((imp) => console.log(`     - ${imp}`));
  }

  // Show largest files
  const filesSorted = Object.entries(metafile.inputs)
    .map(([filePath, data]) => ({
      path: filePath.replace(`${TEMP_BUILD_DIR}/`, "src/"),
      size: data.bytes,
      imports: data.imports?.length || 0,
    }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 15);

  console.log("\n📁 Largest Library Files (Top 15):");
  console.log("==================================");
  filesSorted.forEach((file, index) => {
    const sizeStr = formatBytes(file.size).padEnd(8);
    const importsStr = `(${file.imports} imports)`;
    console.log(
      `${(index + 1).toString().padStart(2)}. ${file.path.padEnd(60)} ${sizeStr} ${importsStr}`,
    );
  });

  // Calculate total input size
  const totalInputSize = Object.values(metafile.inputs).reduce(
    (sum, input) => sum + input.bytes,
    0,
  );
  const compressionRatio = (
    ((totalInputSize - bundleSize) / totalInputSize) *
    100
  ).toFixed(1);

  console.log("\n📈 Production Peer Dependencies Bundle Summary:");
  console.log("==============================================");
  console.log(`Library code input:    ${formatBytes(totalInputSize)}`);
  console.log(`Library bundle:        ${formatBytes(bundleSize)}`);
  console.log(`Library compression:   ${compressionRatio}%`);
  console.log(`Library files:         ${Object.keys(metafile.inputs).length}`);
  console.log(`Dependencies bundled:  0 (all external)`);
  console.log(`Minified:              Yes`);
  console.log(`Log calls removed:     Yes`);
  console.log(`Tree shaking:          Yes`);
  console.log(`Bundle approach:       Peer Dependencies`);

  console.log("\n💡 Installation Instructions for Users:");
  console.log("======================================");
  console.log("Users will need to install peer dependencies separately:");
  console.log("   npm install @amzn/dex-internal-sdk");
  console.log("   npm install @aws-sdk/credential-provider-node");
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function cleanupTempFiles(): void {
  console.log("🧹 Cleaning up temporary files...");
  if (fs.existsSync(TEMP_BUILD_DIR)) {
    rimraf.sync(TEMP_BUILD_DIR);
  }
}

function main(): void {
  try {
    console.log("🚀 Starting production build with peer dependencies...\n");

    // Step 1: Clean dist folder
    cleanDistFolder();

    // Step 2: Create temporary build directory with source copy
    createTempBuildDirectory();

    // Step 3: Remove log calls from the temporary copy
    removeLogCalls();

    // Step 4: Identify all dependencies that should be external
    const externalDependencies = getExternalDependencies();

    // Step 5: Build optimized library code bundle (with all dependencies marked as external)
    const libResult = buildLibraryBundle(externalDependencies);

    if (externalDependencies.length === 0) {
      console.log(
        "🚫 No dependencies bundle created - all dependencies are external",
      );
    }

    // Step 6: Generate TypeScript declarations
    generateTypeDeclarations();

    // Step 7: Analyze and report bundle information
    const bundleStats = fs.statSync(`${DIST_DIR}/index.js`);
    analyzeBundle(libResult.metafile as BuildMetafile, bundleStats.size);

    // Step 8: Cleanup
    cleanupTempFiles();

    console.log(
      "\n✅ Production peer dependencies build completed successfully! 🎉",
    );
    console.log("📁 Output files:");
    console.log(`   - ${DIST_DIR}/index.js (optimized library code only)`);
    console.log(`   - ${DIST_DIR}/index.d.ts (type declarations)`);
  } catch (error) {
    console.error("❌ Build failed:", (error as Error).message);
    cleanupTempFiles();
    process.exit(1);
  }
}

// Run main function if this script is executed directly
if (require.main === module) {
  main();
}

export { main as buildProduction };
