#!/usr/bin/env python3
import re
import glob

def fix_file(filepath, pattern, replacement):
    with open(filepath, 'r') as f:
        content = f.read()
    
    new_content = re.sub(pattern, replacement, content, flags=re.MULTILINE)
    
    if new_content != content:
        with open(filepath, 'w') as f:
            f.write(new_content)
        print(f"Fixed: {filepath}")
        return True
    return False

# Fix callback tests - add childPromises before parentId
for file in glob.glob('packages/aws-durable-execution-sdk-js/src/handlers/callback-handler/*.test.ts'):
    fix_file(file, 
             r'(checkAndUpdateReplayMode,)\n(\s+)(parentId,)',
             r'\1\n\2new Set(), // childPromises\n\2\3')

# Fix wait-for-condition tests - add childPromises before parentId  
for file in glob.glob('packages/aws-durable-execution-sdk-js/src/handlers/wait-for-condition-handler/*.test.ts'):
    fix_file(file,
             r'(getOperationsEmitter\.bind\(this\),)\n(\s+)(parentId,)',
             r'\1\n\2new Set(), // childPromises\n\2\3')

# Fix wait-for-callback tests - add childPromises after runInChildContext
for file in glob.glob('packages/aws-durable-execution-sdk-js/src/handlers/wait-for-callback-handler/*.test.ts'):
    fix_file(file,
             r'(runInChildContext\.bind\(this\),)\n(\s+)\)',
             r'\1\n\2new Set(), // childPromises\n\2)')

# Fix run-in-child-context tests - add childPromises before parentId
for file in glob.glob('packages/aws-durable-execution-sdk-js/src/handlers/run-in-child-context-handler/*.test.ts'):
    fix_file(file,
             r'(\),)\n(\s+)(parentId,)',
             r'\1\n\2new Set(), // childPromises\n\2\3')

print("All test files fixed!")
