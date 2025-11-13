const fs = require("fs");
const path = require("path");

const sdkSourcePath = path.resolve(
  __dirname,
  "../../aws-durable-execution-sdk-js/src",
);
const targetPath = path.resolve(__dirname, "../src/dur-sdk");

if (fs.existsSync(targetPath)) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

fs.cpSync(sdkSourcePath, targetPath, { recursive: true });

console.log(`✓ Copied SDK source to ${targetPath}`);
