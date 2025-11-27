#!/usr/bin/env python3
import re

def fix_file(filepath, pattern, replacement):
    """Fix a file by applying regex replacement"""
    try:
        with open(filepath, 'r') as f:
            content = f.read()
        
        new_content = re.sub(pattern, replacement, content, flags=re.MULTILINE | re.DOTALL)
        
        if new_content != content:
            with open(filepath, 'w') as f:
                f.write(new_content)
            print(f"✓ Fixed: {filepath}")
            return True
        else:
            print(f"  No changes: {filepath}")
            return False
    except Exception as e:
        print(f"✗ Error in {filepath}: {e}")
        return False

# Fix patterns for each handler type
fixes = [
    # wait-for-callback: add new Set() after runInChildContext
    ('packages/aws-durable-execution-sdk-js/src/handlers/wait-for-callback-handler/wait-for-callback-handler.test.ts',
     r'(mockRunInChildContext,)\n(\s+)\);',
     r'\1\n\2new Set(),\n\2);'),
    
    # wait-handler-two-phase: add new Set() after mockOperationsEmitter
    ('packages/aws-durable-execution-sdk-js/src/handlers/wait-handler/wait-handler-two-phase.test.ts',
     r'(\(\) => mockOperationsEmitter,)\n(\s+)\);',
     r'\1\n\2new Set(),\n\2);'),
    
    # wait-for-condition timing: add new Set() and undefined
    ('packages/aws-durable-execution-sdk-js/src/handlers/wait-for-condition-handler/wait-for-condition-handler.timing.test.ts',
     r'(getOperationsEmitter\.bind\(this\),)\n(\s+)\);',
     r'\1\n\2new Set(),\n\2undefined,\n\2);'),
    
    # invoke-handler-two-phase: add new Set() after EventEmitter
    ('packages/aws-durable-execution-sdk-js/src/handlers/invoke-handler/invoke-handler-two-phase.test.ts',
     r'(\(\) => new EventEmitter\(\),)\n(\s+)\);',
     r'\1\n\2new Set(),\n\2);'),
    
    # step-handler timing: add new Set() after mockOperationsEmitter
    ('packages/aws-durable-execution-sdk-js/src/handlers/step-handler/step-handler.timing.test.ts',
     r'(\(\) => mockOperationsEmitter,)\n(\s+)\);',
     r'\1\n\2new Set(),\n\2);'),
    
    # wait-for-condition test: add new Set() and undefined
    ('packages/aws-durable-execution-sdk-js/src/handlers/wait-for-condition-handler/wait-for-condition-handler.test.ts',
     r'(getOperationsEmitter\.bind\(this\),)\n(\s+)\);',
     r'\1\n\2new Set(),\n\2undefined,\n\2);'),
    
    # wait-for-condition-two-phase: add new Set() and undefined
    ('packages/aws-durable-execution-sdk-js/src/handlers/wait-for-condition-handler/wait-for-condition-handler-two-phase.test.ts',
     r'(getOperationsEmitter\.bind\(this\),)\n(\s+)\);',
     r'\1\n\2new Set(),\n\2undefined,\n\2);'),
    
    # step-handler-two-phase: add new Set() after mockOperationsEmitter
    ('packages/aws-durable-execution-sdk-js/src/handlers/step-handler/step-handler-two-phase.test.ts',
     r'(\(\) => mockOperationsEmitter,)\n(\s+)\);',
     r'\1\n\2new Set(),\n\2);'),
    
    # run-in-child-context-two-phase: add new Set() before parentId
    ('packages/aws-durable-execution-sdk-js/src/handlers/run-in-child-context-handler/run-in-child-context-handler-two-phase.test.ts',
     r'(\),)\n(\s+)(parentId,)',
     r'\1\n\2new Set(),\n\2\3'),
    
    # wait-handler test: add new Set() after mockOperationsEmitter (only if not already there)
    ('packages/aws-durable-execution-sdk-js/src/handlers/wait-handler/wait-handler.test.ts',
     r'(\(\) => mockOperationsEmitter,)\n(\s+)\);(?!\s*new Set)',
     r'\1\n\2new Set(),\n\2);'),
    
    # map-handler-two-phase: add new Set() after mockExecuteConcurrently
    ('packages/aws-durable-execution-sdk-js/src/handlers/map-handler/map-handler-two-phase.test.ts',
     r'(mockExecuteConcurrently,)\n(\s+)\);',
     r'\1\n\2new Set(),\n\2);'),
    
    # callback-promise: add new Set() after jest.fn()
    ('packages/aws-durable-execution-sdk-js/src/handlers/callback-handler/callback-promise.test.ts',
     r'(jest\.fn\(\),)\n(\s+)\);',
     r'\1\n\2new Set(),\n\2);'),
    
    # step-handler test: add new Set() after mockOperationsEmitter (only if not already there)
    ('packages/aws-durable-execution-sdk-js/src/handlers/step-handler/step-handler.test.ts',
     r'(\(\) => mockOperationsEmitter,)\n(\s+)\);(?!\s*new Set)',
     r'\1\n\2new Set(),\n\2);'),
]

print("Fixing test files...\n")
for filepath, pattern, replacement in fixes:
    fix_file(filepath, pattern, replacement)

print("\nDone!")
