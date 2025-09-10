/**
 * Script to check if file and directory names follow kebab-case convention
 * Usage: find src -type f -name "*.ts" | node scripts/check-filenames.js
 */

const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

// ANSI color codes
const colors = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
};

// Regular expression for kebab-case: lowercase letters, numbers, and hyphens
// File/directory name must start with a letter and end with a letter or number
const kebabCaseRegex = /^[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z0-9]+)*$/;

let hasErrors = false;
const processedPaths = new Set();
const processedDirs = new Set();

rl.on("line", (filePath) => {
  if (processedPaths.has(filePath)) return;
  processedPaths.add(filePath);

  // Check file name
  const parts = filePath.split("/");
  const fileName = parts[parts.length - 1];
  const fileNameWithoutExt = fileName.split(".")[0];

  if (!kebabCaseRegex.test(fileNameWithoutExt)) {
    console.error(
      `${colors.red}${colors.bold}Error:${colors.reset} File name "${colors.yellow}${fileName}${colors.reset}" does not follow kebab-case convention`,
    );
    hasErrors = true;
  }

  // Check directory names
  for (let i = 0; i < parts.length - 1; i++) {
    const dirPath = parts.slice(0, i + 1).join("/");
    const dirName = parts[i];

    // Skip already processed directories and src directory
    if (processedDirs.has(dirPath) || dirName === "src") continue;
    processedDirs.add(dirPath);

    if (!kebabCaseRegex.test(dirName) && dirName !== "src") {
      console.error(
        `${colors.red}${colors.bold}Error:${colors.reset} Directory name "${colors.yellow}${dirName}${colors.reset}" in path "${colors.blue}${dirPath}${colors.reset}" does not follow kebab-case convention`,
      );
      hasErrors = true;
    }
  }
});

rl.on("close", () => {
  if (hasErrors) {
    console.error(
      `\n${colors.red}${colors.bold}File/directory naming convention check failed!${colors.reset}`,
    );
    console.error(
      `${colors.bold}All file and directory names should follow kebab-case convention:${colors.reset}`,
    );
    console.error(`- Use lowercase letters and numbers`);
    console.error(`- Separate words with hyphens`);
    console.error(`- Start with a letter`);
    console.error(`- No special characters except hyphens`);
    console.error(`\n${colors.bold}Examples of valid names:${colors.reset}`);
    console.error(`- ${colors.green}user-service.ts${colors.reset}`);
    console.error(`- ${colors.green}api-gateway${colors.reset}`);
    console.error(`- ${colors.green}auth-middleware.ts${colors.reset}`);
    process.exit(1);
  } else {
    console.log(
      `${colors.green}${colors.bold}All file and directory names follow kebab-case convention!${colors.reset}`,
    );
  }
});
