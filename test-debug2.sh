#!/bin/bash
set -euo pipefail
source .github/workflows/iterate-publish-npm.sh

# Test prerelease to beta (should pass)
cd packages/test-prerelease
VERSION=$(node -p "require('./package.json').version")
PACKAGE_NAME=$(node -p "require('./package.json').name")

PRERELEASE=true
echo "Testing prerelease to beta (should pass):"
check_prerelease_version "$VERSION" "$PACKAGE_NAME"
echo "✓ Prerelease to beta allowed"

# Test stable to latest (should pass)
cd ../test-stable  
VERSION=$(node -p "require('./package.json').version")
PACKAGE_NAME=$(node -p "require('./package.json').name")

PRERELEASE=false
echo "Testing stable to latest (should pass):"
check_prerelease_version "$VERSION" "$PACKAGE_NAME" 
echo "✓ Stable to latest allowed"
