const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const handlerFile = process.argv[2];
if (!handlerFile) {
  console.error("Usage: node package.js <handler-file>");
  process.exit(1);
}

// Extract just the file name without .handler suffix
const fileName = handlerFile.replace(".handler", "");

console.log(`Packaging ${fileName}...`);

const tempDir = path.resolve(__dirname, "../temp-package");

// Clean up any existing temp directory
if (fs.existsSync(tempDir)) {
  execSync(`rm -rf ${tempDir}`);
}

// Create temp directory
fs.mkdirSync(tempDir);

// Copy JS file
fs.copyFileSync(
  path.join("dist", fileName + ".js"),
  path.join(tempDir, fileName + ".js"),
);

// Copy dependencies
fs.copyFileSync(
  path.join("dist", "vendors.js"),
  path.join(tempDir, "vendors.js"),
);

// Copy source map if exists
try {
  fs.copyFileSync(
    path.join("dist", fileName + ".js.map"),
    path.join(tempDir, fileName + ".js.map"),
  );
  fs.copyFileSync(
    path.join("dist", "vendors.js.map"),
    path.join(tempDir, "vendors.js.map"),
  );
} catch {}

// Copy collector.yaml for community collector otel functions
if (fileName.includes("otel-community-collector")) {
  // Derive folder name from handler file name:
  // "otel-community-collector-xray-e2e" -> "community-collector-xray-e2e"
  // "otel-community-collector-invocation-xray-e2e" -> "community-collector-invocation-xray-e2e"
  const folderName = fileName.replace("otel-", "");
  const collectorSrc = path.join(
    __dirname,
    `../src/examples/otel/${folderName}/collector.yaml`,
  );
  if (fs.existsSync(collectorSrc)) {
    fs.copyFileSync(collectorSrc, path.join(tempDir, "collector.yaml"));
    console.log(
      "  Included collector.yaml for community collector OTel function",
    );
  }
}

// Create zip file with quiet mode to avoid buffer overflow
const zipFile = `${handlerFile}.zip`;
execSync(`cd ${tempDir} && zip -q -r ../${zipFile} .`);

// Clean up
execSync(`rm -rf ${tempDir}`);

console.log(`Created: ${zipFile}`);
