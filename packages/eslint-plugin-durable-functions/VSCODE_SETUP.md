# VS Code Setup for ESLint Plugin

To see ESLint errors and warnings in VS Code when working with the durable functions examples:

## 1. Install VS Code ESLint Extension

Install the official ESLint extension:
- Open VS Code
- Go to Extensions (Ctrl+Shift+X)
- Search for "ESLint" by Microsoft
- Install it

## 2. Build the Plugin

First, make sure the plugin is built:
```bash
cd packages/eslint-plugin-durable-functions
npm run build
```

## 3. ESLint Configuration (Already Done!)

The monorepo is configured to check:
- All TypeScript files in `packages/examples/src/examples/`
- The plugin example file

## 4. Test the Setup

1. Open VS Code in the monorepo root directory
2. Open any file in `packages/examples/src/examples/`
3. You should see red squiggly lines under nested durable operations

## 5. Current Issues Found

The plugin has already found real issues in the examples:

**❌ `packages/examples/src/examples/parallel-basic.ts` (lines 6, 11, 16):**
```typescript
const results = await context.parallel("parallel", [
    async (context: DurableContext) => {
        return await context.step(async () => {  // ← Error: nested in parallel
            return "task 1 completed";
        });
    },
    // ... more nested operations
]);
```

**❌ `packages/examples/src/examples/map-basic.ts` (line 10):**
```typescript
const results = await context.map(items, async (item, context) => {
    return await context.step(async () => {  // ← Error: nested in map
        return `Processed: ${item}`;
    });
});
```

## 6. How to Fix These Issues

Use `runInChildContext` for nested operations:

**✅ Correct approach:**
```typescript
const results = await context.parallel("parallel", [
    async () => {
        return await context.runInChildContext("task1", async (childCtx) => {
            return await childCtx.step(async () => {
                return "task 1 completed";
            });
        });
    }
]);
```

## 7. Command Line Testing

Test all examples:
```bash
# From monorepo root
npx eslint "packages/examples/src/examples/*.ts"
```

Test specific file:
```bash
npx eslint packages/examples/src/examples/parallel-basic.ts
```

## 8. VS Code Experience

When you open the example files in VS Code, you'll see:
- **Red squiggly lines** under problematic nested operations
- **Error messages** when you hover: "Durable operation 'step' cannot be nested inside another durable operation. Use runInChildContext for nested operations"
- **Problems panel** (Ctrl+Shift+M) showing all issues

## Troubleshooting

If you don't see errors in VS Code:
1. Make sure the ESLint extension is enabled
2. Check the VS Code output panel (View → Output → ESLint) for errors
3. Try reloading VS Code (Ctrl+Shift+P → "Developer: Reload Window")
4. Ensure you're opening VS Code from the monorepo root directory
5. Make sure the plugin is built: `npm run build` in the plugin directory
