#!/usr/bin/env python3
import re
import sys

def fix_handler_calls(filepath, handler_name, param_count):
    """Fix handler creation calls by adding new Set() parameter"""
    with open(filepath, 'r') as f:
        content = f.read()
    
    # Pattern to match handler creation with specific number of params
    # Matches: createHandler(\n  param1,\n  param2,\n  ...\n);
    pattern = rf'({handler_name}\([^)]+(?:\n[^)]+){{{param_count-1}}})\n(\s+)\);'
    replacement = r'\1,\n\2new Set(),\n\2);'
    
    new_content = re.sub(pattern, replacement, content, flags=re.MULTILINE)
    
    if new_content != content:
        with open(filepath, 'w') as f:
            f.write(new_content)
        return True
    return False

# Fix patterns for each handler type
fixes = [
    ('packages/aws-durable-execution-sdk-js/src/handlers/invoke-handler/*.test.ts', 'createInvokeHandler', 5),
    ('packages/aws-durable-execution-sdk-js/src/handlers/wait-handler/*.test.ts', 'createWaitHandler', 5),
    ('packages/aws-durable-execution-sdk-js/src/handlers/step-handler/*.test.ts', 'createStepHandler', 9),
    ('packages/aws-durable-execution-sdk-js/src/handlers/callback-handler/callback.test.ts', 'createCallback', 6),
    ('packages/aws-durable-execution-sdk-js/src/handlers/wait-for-condition-handler/*.test.ts', 'createWaitForConditionHandler', 9),
    ('packages/aws-durable-execution-sdk-js/src/handlers/wait-for-callback-handler/*.test.ts', 'createWaitForCallbackHandler', 3),
    ('packages/aws-durable-execution-sdk-js/src/handlers/run-in-child-context-handler/*.test.ts', 'createRunInChildContextHandler', 6),
    ('packages/aws-durable-execution-sdk-js/src/handlers/parallel-handler/*two-phase*.test.ts', 'createParallelHandler', 2),
    ('packages/aws-durable-execution-sdk-js/src/handlers/map-handler/*two-phase*.test.ts', 'createMapHandler', 2),
]

import glob
for pattern, handler, count in fixes:
    for file in glob.glob(pattern):
        if fix_handler_calls(file, handler, count):
            print(f"Fixed: {file}")

print("All test files fixed!")
