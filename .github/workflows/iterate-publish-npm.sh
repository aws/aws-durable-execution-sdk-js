#!/bin/bash
set -uo pipefail

PRERELEASE=${1:-false}
FAILED=0

# Function to check if version has any non-numeric suffix
check_prerelease_version() {
  local version=$1
  local package_name=$2
  
  # Check if version contains anything other than numbers and dots after the main version
  if [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+-.+ ]]; then
    if [ "$PRERELEASE" != "true" ]; then
      echo "ERROR: Package '$package_name' has pre-release version '$version' but would publish to 'latest' tag"
      echo "Versions with suffixes cannot be published to the 'latest' tag"
      exit 1
    fi
  fi
}

# Function to verify and rollback if needed
verify_and_rollback() {
  local package_name=$1
  local version=$2
  local expected_tag=$3
  
  echo "Verifying dist-tags for $package_name..."
  
  # Retry logic for npm registry propagation
  local max_attempts=6
  local attempt=1
  local delay=5
  
  while [ $attempt -le $max_attempts ]; do
    echo "Attempt $attempt/$max_attempts: Checking dist-tags..."
    
    # Get current dist-tags
    local dist_tags=$(npm view "$package_name" dist-tags --json --registry https://registry.npmjs.org 2>/dev/null || echo "{}")
    local current_latest=$(echo "$dist_tags" | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8')).latest || 'none'")
    
    # Check if the mapping is correct
    local verification_passed=false
    if [ "$expected_tag" = "latest" ]; then
      if [ "$current_latest" = "$version" ]; then
        verification_passed=true
      fi
    else
      # For beta tag, latest should not be our version
      if [ "$current_latest" != "$version" ]; then
        verification_passed=true
      fi
    fi
    
    if [ "$verification_passed" = true ]; then
      echo "✓ Dist-tags verification passed for $package_name"
      return 0
    fi
    
    if [ $attempt -eq $max_attempts ]; then
      echo "ERROR: After $max_attempts attempts, dist-tags still incorrect"
      if [ "$expected_tag" = "latest" ]; then
        echo "Expected latest=$version, but got latest=$current_latest"
      else
        echo "Beta version $version incorrectly tagged as latest"
      fi
      rollback_and_alert "$package_name" "$version"
      return 1
    fi
    
    echo "Registry not updated yet, waiting ${delay}s before retry..."
    sleep $delay
    delay=$((delay * 2))  # Exponential backoff: 5, 10, 20, 40, 80s
    attempt=$((attempt + 1))
  done
}

# Function to rollback and alert
rollback_and_alert() {
  local package_name=$1
  local bad_version=$2
  
  echo "🚨 ROLLBACK: Attempting to restore previous stable version as latest..."
  
  # Get all versions and find the previous stable one
  local versions=$(npm view "$package_name" versions --json 2>/dev/null || echo "[]")
  local previous_stable=$(echo "$versions" | node -p "
    const versions = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
    const stable = versions.filter(v => !v.includes('-')).sort((a,b) => {
      const aParts = a.split('.').map(Number);
      const bParts = b.split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        if (aParts[i] !== bParts[i]) return bParts[i] - aParts[i];
      }
      return 0;
    });
    stable[0] || 'none';
  ")
  
  if [ "$previous_stable" != "none" ]; then
    echo "Restoring $previous_stable as latest..."
    npm dist-tag add "$package_name@$previous_stable" latest || echo "Failed to rollback"
  fi
  
  # Alert (using GitHub Actions if available, otherwise echo)
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    echo "::error::CRITICAL: Package $package_name version $bad_version has incorrect dist-tags. Attempted rollback to $previous_stable"
  else
    echo "🚨 ALERT: Package $package_name version $bad_version has incorrect dist-tags!"
  fi
}

for package_dir in packages/*; do
  if [ -d "$package_dir" ] && [[ "$package_dir" == "packages/aws-durable-execution-sdk-js-testing" || "$package_dir" == "packages/aws-durable-execution-sdk-js" || "$package_dir" == "packages/aws-durable-execution-sdk-js-eslint-plugin" ]]; then
    echo "Publishing package in $package_dir";
    cd "$package_dir";
    
    # Extract version and package name for validation
    VERSION=$(node -p "require('./package.json').version")
    PACKAGE_NAME=$(node -p "require('./package.json').name")
    
    # Validate pre-release version against tag
    check_prerelease_version "$VERSION" "$PACKAGE_NAME"
    
    # Publish
    if [ "$PRERELEASE" = "true" ]; then
      npm publish --access public --tag beta || FAILED=1
      EXPECTED_TAG="beta"
    else
      npm publish --access public || FAILED=1
      EXPECTED_TAG="latest"
    fi
    
    # Verify dist-tags after publish
    if [ "$FAILED" -eq 0 ]; then
      verify_and_rollback "$PACKAGE_NAME" "$VERSION" "$EXPECTED_TAG" || FAILED=1
    fi
    
    cd ../..;
  fi
done

if [ "$FAILED" -ne 0 ]; then
  echo "ERROR: One or more packages failed to publish or verify"
  exit 1
fi
