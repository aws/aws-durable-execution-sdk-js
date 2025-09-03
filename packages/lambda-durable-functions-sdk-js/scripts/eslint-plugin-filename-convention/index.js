/**
 * @fileoverview ESLint plugin to enforce kebab-case for file names
 */
"use strict";

const path = require("path");
const fs = require("fs");

// Regular expression for kebab-case: lowercase letters, numbers, and hyphens
// File/directory name must start with a letter and end with a letter or number
const kebabCaseRegex = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// Default patterns to ignore if no ESLint config is available
const defaultIgnorePatterns = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.git/**",
];

/**
 * Simple glob pattern matching using built-in Node.js functionality
 * @param {string} filePath - The file path to check
 * @param {string} pattern - The glob pattern to match against
 * @returns {boolean} - Whether the file path matches the pattern
 */
function matchesGlobPattern(filePath, pattern) {
  // Convert glob pattern to regex
  // Handle common glob patterns:
  // - ** matches any number of directories
  // - * matches any characters except path separators
  const regexPattern = pattern
    .replace(/\*\*/g, "{{DOUBLE_ASTERISK}}")
    .replace(/\*/g, "[^/\\\\]*")
    .replace(/\?/g, "[^/\\\\]")
    .replace(/{{DOUBLE_ASTERISK}}/g, ".*")
    .replace(/\./g, "\\.")
    .replace(/\//g, "\\/");

  // Create regex with start and end anchors
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(filePath);
}

/**
 * Find the project root directory (where package.json is located)
 * @param {string} startDir - Directory to start searching from
 * @returns {string|null} - Project root path or null if not found
 */
function findProjectRoot(startDir) {
  let currentDir = startDir;

  // Limit the number of iterations to prevent infinite loops
  const maxIterations = 10;
  let iterations = 0;

  while (currentDir && iterations < maxIterations) {
    iterations++;

    // Check if package.json exists in this directory
    if (fs.existsSync(path.join(currentDir, "package.json"))) {
      return currentDir;
    }

    // Move up one directory
    const parentDir = path.dirname(currentDir);

    // Stop if we've reached the root directory
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  return null;
}

module.exports = {
  rules: {
    "kebab-case": {
      meta: {
        type: "suggestion",
        docs: {
          description: "Enforce kebab-case file naming convention",
          category: "Stylistic Issues",
          recommended: true,
        },
        fixable: null,
        schema: [],
      },
      create: function (context) {
        // Use default ignore patterns (ESLint v9+ doesn't support CLIEngine)
        let ignorePatterns = defaultIgnorePatterns;

        // Function to check if a path should be ignored
        const shouldIgnorePath = (filePath) => {
          // Convert to posix path for consistent pattern matching
          const posixPath = filePath.split(path.sep).join("/");

          return ignorePatterns.some((pattern) => {
            return matchesGlobPattern(posixPath, pattern);
          });
        };

        return {
          Program: function (node) {
            const filename = context.getFilename();
            if (filename === "<input>") return; // Ignore if not a file

            // Skip files that match ignore patterns
            if (shouldIgnorePath(filename)) return;

            // Find the project root directory
            const projectRoot = findProjectRoot(path.dirname(filename));
            if (!projectRoot) return; // If we can't find the project root, skip checking

            // Check the filename
            const basename = path.basename(filename);
            const filenameWithoutExt = basename.split(".")[0];

            if (!kebabCaseRegex.test(filenameWithoutExt)) {
              context.report({
                node,
                message:
                  "Filename '{{filename}}' does not follow kebab-case convention",
                data: {
                  filename: basename,
                },
              });
            }

            // Check directory names, but only those within the project
            const dirname = path.dirname(filename);

            // Only check directories that are within the project root
            if (dirname.startsWith(projectRoot)) {
              // Get the relative path from the project root
              const relativePath = path.relative(projectRoot, dirname);

              // Skip if the path is empty (file is directly in the project root)
              if (!relativePath) return;

              // Split the relative path into parts
              const parts = relativePath.split(path.sep);

              for (const part of parts) {
                // Skip empty parts, root directory, and special directories
                if (!part || part === "." || part === "..") {
                  continue;
                }

                // Skip directories that match ignore patterns
                const dirPath = path.join(
                  projectRoot,
                  ...parts.slice(0, parts.indexOf(part) + 1),
                );
                if (shouldIgnorePath(dirPath)) {
                  continue;
                }

                if (!kebabCaseRegex.test(part)) {
                  context.report({
                    node,
                    message:
                      "Directory name '{{dirname}}' does not follow kebab-case convention",
                    data: {
                      dirname: part,
                    },
                  });
                }
              }
            }
          },
        };
      },
    },
  },
};
