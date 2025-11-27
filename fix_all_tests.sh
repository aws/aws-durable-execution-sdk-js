#!/bin/bash
set -e

cd packages/aws-durable-execution-sdk-js

echo "Fixing test files..."

# Fix wait-for-condition timing
awk '/createWaitForConditionHandler\(/,/\);$/ {
  if (/getOperationsEmitter\.bind\(this\),/) {
    print
    getline
    if (/^[[:space:]]*\);/) {
      sub(/\);/, "new Set(),\n      undefined,\n      );")
    }
    print
    next
  }
}
{print}' src/handlers/wait-for-condition-handler/wait-for-condition-handler.timing.test.ts > /tmp/wfc-timing.ts && \
mv /tmp/wfc-timing.ts src/handlers/wait-for-condition-handler/wait-for-condition-handler.timing.test.ts
echo "✓ wait-for-condition-handler.timing.test.ts"

# Fix invoke-handler-two-phase
awk '/createInvokeHandler\(/,/\);$/ {
  if (/\(\) => new EventEmitter\(\),/) {
    print
    getline
    if (/^[[:space:]]*\);/) {
      sub(/\);/, "new Set(),\n        );")
    }
    print
    next
  }
}
{print}' src/handlers/invoke-handler/invoke-handler-two-phase.test.ts > /tmp/invoke-two.ts && \
mv /tmp/invoke-two.ts src/handlers/invoke-handler/invoke-handler-two-phase.test.ts
echo "✓ invoke-handler-two-phase.test.ts"

# Fix step-handler timing
awk '/createStepHandler\(/,/\);$/ {
  if (/\(\) => mockOperationsEmitter,/) {
    print
    getline
    if (/^[[:space:]]*\);/) {
      sub(/\);/, "new Set(),\n      );")
    }
    print
    next
  }
}
{print}' src/handlers/step-handler/step-handler.timing.test.ts > /tmp/step-timing.ts && \
mv /tmp/step-timing.ts src/handlers/step-handler/step-handler.timing.test.ts
echo "✓ step-handler.timing.test.ts"

# Fix wait-for-condition test
awk '/createWaitForConditionHandler\(/,/\);$/ {
  if (/getOperationsEmitter\.bind\(this\),/) {
    print
    getline
    if (/^[[:space:]]*\);/) {
      sub(/\);/, "new Set(),\n      undefined,\n      );")
    }
    print
    next
  }
}
{print}' src/handlers/wait-for-condition-handler/wait-for-condition-handler.test.ts > /tmp/wfc-test.ts && \
mv /tmp/wfc-test.ts src/handlers/wait-for-condition-handler/wait-for-condition-handler.test.ts
echo "✓ wait-for-condition-handler.test.ts"

# Fix wait-for-condition-two-phase
awk '/createWaitForConditionHandler\(/,/\);$/ {
  if (/getOperationsEmitter\.bind\(this\),/) {
    print
    getline
    if (/^[[:space:]]*\);/) {
      sub(/\);/, "new Set(),\n      undefined,\n      );")
    }
    print
    next
  }
}
{print}' src/handlers/wait-for-condition-handler/wait-for-condition-handler-two-phase.test.ts > /tmp/wfc-two.ts && \
mv /tmp/wfc-two.ts src/handlers/wait-for-condition-handler/wait-for-condition-handler-two-phase.test.ts
echo "✓ wait-for-condition-handler-two-phase.test.ts"

# Fix step-handler-two-phase
awk '/createStepHandler\(/,/\);$/ {
  if (/\(\) => mockOperationsEmitter,/) {
    print
    getline
    if (/^[[:space:]]*\);/) {
      sub(/\);/, "new Set(),\n      );")
    }
    print
    next
  }
}
{print}' src/handlers/step-handler/step-handler-two-phase.test.ts > /tmp/step-two.ts && \
mv /tmp/step-two.ts src/handlers/step-handler/step-handler-two-phase.test.ts
echo "✓ step-handler-two-phase.test.ts"

# Fix run-in-child-context-two-phase
awk '/createRunInChildContextHandler\(/,/\);$/ {
  if (/\),/) {
    print
    getline
    if (/parentId,/) {
      print "        new Set(),"
    }
    print
    next
  }
}
{print}' src/handlers/run-in-child-context-handler/run-in-child-context-handler-two-phase.test.ts > /tmp/ric-two.ts && \
mv /tmp/ric-two.ts src/handlers/run-in-child-context-handler/run-in-child-context-handler-two-phase.test.ts
echo "✓ run-in-child-context-handler-two-phase.test.ts"

# Fix map-handler-two-phase
awk '/createMapHandler\(/,/\);$/ {
  if (/mockExecuteConcurrently,/) {
    print
    getline
    if (/^[[:space:]]*\);/) {
      sub(/\);/, "new Set(),\n      );")
    }
    print
    next
  }
}
{print}' src/handlers/map-handler/map-handler-two-phase.test.ts > /tmp/map-two.ts && \
mv /tmp/map-two.ts src/handlers/map-handler/map-handler-two-phase.test.ts
echo "✓ map-handler-two-phase.test.ts"

# Fix callback-promise
awk '/createCallbackPromise\(/,/\);$/ {
  if (/jest\.fn\(\),/) {
    print
    getline
    if (/^[[:space:]]*\);/) {
      sub(/\);/, "new Set(),\n      );")
    }
    print
    next
  }
}
{print}' src/handlers/callback-handler/callback-promise.test.ts > /tmp/cb-promise.ts && \
mv /tmp/cb-promise.ts src/handlers/callback-handler/callback-promise.test.ts
echo "✓ callback-promise.test.ts"

echo ""
echo "All test files fixed!"
