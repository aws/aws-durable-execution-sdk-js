#!/usr/bin/env node

/**
 * Migration script to replace legacy termination patterns with centralized approach
 */

const fs = require("fs");
const path = require("path");

const LEGACY_FILES_TO_REMOVE = [
  "src/utils/wait-before-continue/wait-before-continue.ts",
];

const HANDLER_REPLACEMENTS = {
  "src/handlers/step-handler/step-handler.ts":
    "src/handlers/step-handler/centralized-step-handler.ts",
  "src/handlers/wait-handler/wait-handler.ts":
    "src/handlers/wait-handler/centralized-wait-handler.ts",
  "src/handlers/callback-handler/callback-promise.ts":
    "src/handlers/callback-handler/centralized-callback-promise.ts",
};

const IMPORT_REPLACEMENTS = [
  {
    from: 'import { waitBeforeContinue } from "../../utils/wait-before-continue/wait-before-continue";',
    to: "// waitBeforeContinue removed - using centralized approach",
  },
  {
    from: 'import { terminate } from "../../utils/termination-helper/termination-helper";',
    to: "// terminate removed - using centralized approach",
  },
];

function migrateFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${filePath}`);
    return;
  }

  let content = fs.readFileSync(filePath, "utf8");
  let modified = false;

  // Replace imports
  IMPORT_REPLACEMENTS.forEach((replacement) => {
    if (content.includes(replacement.from)) {
      content = content.replace(replacement.from, replacement.to);
      modified = true;
      console.log(`Replaced import in ${filePath}`);
    }
  });

  if (modified) {
    fs.writeFileSync(filePath, content);
    console.log(`Updated ${filePath}`);
  }
}

function removeFile(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`Removed ${filePath}`);
  }
}

function main() {
  console.log("Starting migration to centralized termination management...\n");

  // Phase 1: Remove legacy imports from files that will be replaced
  console.log("Phase 1: Removing legacy imports...");
  Object.keys(HANDLER_REPLACEMENTS).forEach((filePath) => {
    migrateFile(filePath);
  });

  // Phase 2: Remove legacy files
  console.log("\nPhase 2: Removing legacy files...");
  LEGACY_FILES_TO_REMOVE.forEach((filePath) => {
    removeFile(filePath);
  });

  console.log("\nMigration complete!");
  console.log("\nNext steps:");
  console.log("1. Update durable-context.ts to use centralized handlers");
  console.log("2. Run tests to verify functionality");
  console.log("3. Remove remaining legacy termination helper functions");
}

if (require.main === module) {
  main();
}

module.exports = {
  migrateFile,
  removeFile,
  HANDLER_REPLACEMENTS,
  IMPORT_REPLACEMENTS,
};
