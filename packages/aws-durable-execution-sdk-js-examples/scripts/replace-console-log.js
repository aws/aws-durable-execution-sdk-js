const fs = require("fs");
const path = require("path");
const glob = require("glob");

const examplesDir = path.join(__dirname, "../src/examples");

// Find all .ts files in examples (excluding .test.ts)
const files = glob.sync(`${examplesDir}/**/*.ts`, {
  ignore: ["**/*.test.ts"],
});

files.forEach((file) => {
  let content = fs.readFileSync(file, "utf8");

  // Check if file uses console.log
  if (!content.includes("console.log(")) {
    return;
  }

  // Replace console.log with log
  content = content.replace(/console\.log\(/g, "log(");

  // Check if import already exists
  if (
    content.includes('from "../../utils/logger"') ||
    content.includes("from '../../utils/logger'")
  ) {
    fs.writeFileSync(file, content);
    return;
  }

  // Calculate relative path
  const relativePath = path.relative(
    path.dirname(file),
    path.join(__dirname, "../src/utils"),
  );
  const importPath = relativePath.replace(/\\/g, "/") + "/logger";

  // Find the position after all imports
  const importRegex = /^import\s+.*?;$/gm;
  let lastMatch;
  let match;

  while ((match = importRegex.exec(content)) !== null) {
    lastMatch = match;
  }

  if (lastMatch) {
    const insertPos = lastMatch.index + lastMatch[0].length;
    content =
      content.slice(0, insertPos) +
      `\nimport { log } from "${importPath}";` +
      content.slice(insertPos);
  }

  fs.writeFileSync(file, content);
  console.log(`Updated: ${file}`);
});

console.log("Done!");
