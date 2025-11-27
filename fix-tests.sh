#!/bin/bash

cd packages/aws-durable-execution-sdk-js/src/handlers

# Fix all handler test files by adding new Set() as childPromises parameter

# Wait handler tests
find . -name "*wait-handler*.test.ts" -exec sed -i '' \
  's/createWaitHandler(/createWaitHandler(/g; 
   /createWaitHandler(/,/)/ {
     /getOperationsEmitter/s/),$/,\n      new Set(),\n    ),/
   }' {} \;

# Invoke handler tests  
find . -name "*invoke-handler*.test.ts" -exec sed -i '' \
  's/getOperationsEmitter\.bind(this),$/getOperationsEmitter.bind(this),\n      new Set(),/g' {} \;

# Callback handler tests
find . -name "callback.test.ts" -exec sed -i '' \
  's/checkAndUpdateReplayMode\.bind(this),$/checkAndUpdateReplayMode.bind(this),\n      new Set(),/g' {} \;

# Wait for callback tests
find . -name "*wait-for-callback*.test.ts" -exec sed -i '' \
  's/runInChildContext\.bind(this),$/runInChildContext.bind(this),\n      new Set(),/g' {} \;

# Run in child context tests
find . -name "*run-in-child-context*.test.ts" -exec sed -i '' \
  's/parentId,$/new Set(),\n        parentId,/g' {} \;

echo "Test files fixed"
