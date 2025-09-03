import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

/**
 * Remove log function calls from TypeScript code using AST parsing
 * This script safely removes calls to the log() function from our logger module
 * to reduce bundle size in production
 */

export interface LogRemovalResult {
  code: string;
  hasChanges: boolean;
}

export function removeLogCallsAST(
  sourceCode: string,
  filePath: string,
): LogRemovalResult {
  // Parse the source code into an AST
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
  );

  let hasChanges = false;
  let hasLogImport = false;
  let logImportName = "log"; // Default name, might be aliased

  // First pass: Check if this file imports 'log' from our logger module
  function checkForLogImport(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const modulePath = node.moduleSpecifier.text;
        // Check if it's importing from our logger module
        if (
          modulePath.includes("logger/logger") ||
          modulePath.endsWith("/logger")
        ) {
          if (
            node.importClause &&
            node.importClause.namedBindings &&
            ts.isNamedImports(node.importClause.namedBindings)
          ) {
            const namedImports = node.importClause.namedBindings;
            namedImports.elements.forEach((element) => {
              if (
                (element.propertyName && element.propertyName.text === "log") ||
                (!element.propertyName && element.name.text === "log")
              ) {
                hasLogImport = true;
                // For aliased imports (import { log as myLog }), use the alias name
                logImportName = element.name.text;
              }
            });
          }
        }
      }
    }

    ts.forEachChild(node, checkForLogImport);
  }

  // Check for log imports first
  checkForLogImport(sourceFile);

  // Only proceed with removal if we found a log import from our logger
  if (!hasLogImport) {
    return {
      code: sourceCode,
      hasChanges: false,
    };
  }

  // Transformer function to remove log calls (only if imported from our logger)
  const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
    return (rootNode: ts.SourceFile): ts.SourceFile => {
      function visit(node: ts.Node): ts.Node | undefined {
        // Check if this is a call expression
        if (ts.isCallExpression(node)) {
          // Check if it's a call to our imported 'log' function
          if (
            ts.isIdentifier(node.expression) &&
            node.expression.text === logImportName
          ) {
            hasChanges = true;
            // Return undefined to remove this node
            return undefined;
          }
        }

        // Check if this is an expression statement containing our log call
        if (
          ts.isExpressionStatement(node) &&
          ts.isCallExpression(node.expression)
        ) {
          if (
            ts.isIdentifier(node.expression.expression) &&
            node.expression.expression.text === logImportName
          ) {
            hasChanges = true;
            // Return undefined to remove this statement
            return undefined;
          }
        }

        // Continue visiting child nodes
        return ts.visitEachChild(node, visit, context);
      }

      return ts.visitNode(rootNode, visit) as ts.SourceFile;
    };
  };

  // Apply the transformation
  const result = ts.transform(sourceFile, [transformer]);
  const transformedSourceFile = result.transformed[0];

  // Convert back to source code
  const printer = ts.createPrinter({
    newLine: ts.NewLineKind.LineFeed,
    removeComments: false,
  });

  const transformedCode = printer.printFile(transformedSourceFile);

  // Clean up
  result.dispose();

  return {
    code: transformedCode,
    hasChanges,
  };
}

export function removeLogImportsAST(
  sourceCode: string,
  filePath: string,
): LogRemovalResult {
  // Parse the source code into an AST
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
  );

  let hasChanges = false;

  // Transformer function to remove log imports from our logger module only
  const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
    return (rootNode: ts.SourceFile): ts.SourceFile => {
      function visit(node: ts.Node): ts.Node | undefined {
        // Check if this is an import declaration
        if (ts.isImportDeclaration(node)) {
          // Check if it's importing from our logger module
          if (
            node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier)
          ) {
            const modulePath = node.moduleSpecifier.text;
            if (
              modulePath.includes("logger/logger") ||
              modulePath.endsWith("/logger")
            ) {
              // Check if it has named imports
              if (
                node.importClause &&
                node.importClause.namedBindings &&
                ts.isNamedImports(node.importClause.namedBindings)
              ) {
                const namedImports = node.importClause.namedBindings;
                const filteredElements = namedImports.elements.filter(
                  (element) => {
                    // Remove if it's 'log' or aliased from 'log'
                    return !(
                      (element.propertyName &&
                        element.propertyName.text === "log") ||
                      (!element.propertyName && element.name.text === "log")
                    );
                  },
                );

                if (filteredElements.length === 0) {
                  // If log was the only import, remove the entire import
                  hasChanges = true;
                  return undefined;
                } else if (
                  filteredElements.length < namedImports.elements.length
                ) {
                  // If there are other imports, keep them
                  hasChanges = true;
                  const newNamedImports =
                    ts.factory.createNamedImports(filteredElements);
                  const newImportClause = ts.factory.createImportClause(
                    false,
                    node.importClause.name,
                    newNamedImports,
                  );
                  return ts.factory.createImportDeclaration(
                    node.modifiers,
                    newImportClause,
                    node.moduleSpecifier,
                    node.assertClause,
                  );
                }
              }
            }
          }
        }

        // Continue visiting child nodes
        return ts.visitEachChild(node, visit, context);
      }

      return ts.visitNode(rootNode, visit) as ts.SourceFile;
    };
  };

  // Apply the transformation
  const result = ts.transform(sourceFile, [transformer]);
  const transformedSourceFile = result.transformed[0];

  // Convert back to source code
  const printer = ts.createPrinter({
    newLine: ts.NewLineKind.LineFeed,
    removeComments: false,
  });

  const transformedCode = printer.printFile(transformedSourceFile);

  // Clean up
  result.dispose();

  return {
    code: transformedCode,
    hasChanges,
  };
}

export function processFile(filePath: string): boolean {
  try {
    const originalCode = fs.readFileSync(filePath, "utf8");

    // First remove log calls (only if imported from our logger)
    const logCallsResult = removeLogCallsAST(originalCode, filePath);

    // Then remove log imports (only from our logger module)
    const importsResult = removeLogImportsAST(logCallsResult.code, filePath);

    const hasAnyChanges = logCallsResult.hasChanges || importsResult.hasChanges;

    // Only write if there were changes
    if (hasAnyChanges) {
      fs.writeFileSync(filePath, importsResult.code, "utf8");
      console.log(
        `✅ Removed log calls from: ${path.relative(process.cwd(), filePath)}`,
      );
      return true;
    }
    return false;
  } catch (error) {
    console.error(`❌ Error processing ${filePath}:`, (error as Error).message);
    return false;
  }
}

export function processDirectory(dirPath: string): void {
  let filesProcessed = 0;
  let filesChanged = 0;

  function walkDir(currentPath: string): void {
    const items = fs.readdirSync(currentPath);

    for (const item of items) {
      const itemPath = path.join(currentPath, item);
      const stat = fs.statSync(itemPath);

      if (stat.isDirectory()) {
        // Skip node_modules, dist, and other build directories
        if (
          !["node_modules", "dist", "build", ".git", "coverage"].includes(item)
        ) {
          walkDir(itemPath);
        }
      } else if (
        stat.isFile() &&
        (item.endsWith(".ts") || item.endsWith(".js"))
      ) {
        // Skip test files and the logger file itself
        if (
          !item.includes(".test.") &&
          !item.includes(".spec.") &&
          !itemPath.includes("logger.ts")
        ) {
          filesProcessed++;
          if (processFile(itemPath)) {
            filesChanged++;
          }
        }
      }
    }
  }

  walkDir(dirPath);

  console.log(`\n📊 Summary:`);
  console.log(`   Files processed: ${filesProcessed}`);
  console.log(`   Files changed: ${filesChanged}`);
  console.log(
    `   Log calls removed safely using AST (only from our logger module)! 🎉`,
  );
}

// Main execution
if (require.main === module) {
  const srcDir = path.join(process.cwd(), "src");

  if (!fs.existsSync(srcDir)) {
    console.error("❌ Source directory not found:", srcDir);
    process.exit(1);
  }

  console.log(
    "🧹 Removing log function calls from our logger module using AST parsing...\n",
  );
  processDirectory(srcDir);
}
