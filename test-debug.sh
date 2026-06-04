#!/bin/bash
set -euo pipefail
echo "Sourcing main script..."
source .github/workflows/iterate-publish-npm.sh
echo "✓ Main script sourced successfully (main loop did not execute)"

# Test the validation function
cd packages/test-prerelease
VERSION=$(node -p "require('./package.json').version")
PACKAGE_NAME=$(node -p "require('./package.json').name")
echo "Testing package: $PACKAGE_NAME version $VERSION"

PRERELEASE=false
echo "Testing with PRERELEASE=false (should fail):"
if check_prerelease_version "$VERSION" "$PACKAGE_NAME"; then
  echo "ERROR: Should have failed"
  exit 1
else
  echo "✓ Correctly blocked pre-release to latest"
fi
