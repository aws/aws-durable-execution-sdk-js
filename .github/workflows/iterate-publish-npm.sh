#!/bin/bash
set -uo pipefail

PRERELEASE=${1:-false}
FAILED=0

# The set of packages we publish, in order. These are co-versioned and must be
# released together; a partial release is not acceptable.
TARGET_PACKAGES=(
  "packages/aws-durable-execution-sdk-js"
  "packages/aws-durable-execution-sdk-js-testing"
  "packages/aws-durable-execution-sdk-js-eslint-plugin"
)

# Determine the dist-tag we publish to based on the release type.
# Prerelease GitHub Releases publish to `beta`; regular releases to `latest`.
publish_tag() {
  if [ "$PRERELEASE" = "true" ]; then
    echo "beta"
  else
    echo "latest"
  fi
}

# Read a field from a package directory's package.json.
read_pkg_field() {
  local package_dir=$1
  local field=$2
  node -p "require('./$package_dir/package.json').$field"
}

# Validate that a version is allowed for the resolved publish tag.
# A version with a pre-release suffix (anything after MAJOR.MINOR.PATCH-) must
# never be published to the `latest` tag. Returns non-zero on violation.
check_prerelease_version() {
  local version=$1
  local package_name=$2

  if [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+-.+ ]]; then
    if [ "$PRERELEASE" != "true" ]; then
      echo "ERROR: Package '$package_name' has pre-release version '$version' but would publish to 'latest' tag"
      echo "Versions with suffixes cannot be published to the 'latest' tag"
      return 1
    fi
  fi
  return 0
}

# Pre-flight pass: validate EVERY target package before publishing anything.
# This prevents a partial release of a co-versioned monorepo: if any package
# fails validation we abort before the first irreversible `npm publish`.
preflight_validate() {
  local failed=0
  local package_dir version package_name
  for package_dir in "${TARGET_PACKAGES[@]}"; do
    [ -d "$package_dir" ] || continue
    version=$(read_pkg_field "$package_dir" "version")
    package_name=$(read_pkg_field "$package_dir" "name")
    if ! check_prerelease_version "$version" "$package_name"; then
      failed=1
    fi
  done
  return $failed
}

# Publish a single package. Treats "already published at this version" as
# success so that re-running a partially-failed job is idempotent (a re-run
# must be able to go green once the underlying state is correct).
publish_package() {
  local package_dir=$1
  local tag=$2
  local output status

  output=$( (cd "$package_dir" && npm publish --access public --tag "$tag") 2>&1 )
  status=$?
  echo "$output"

  if [ $status -eq 0 ]; then
    return 0
  fi

  # npm returns an error when the version already exists on the registry
  # (e.g. "You cannot publish over the previously published versions" /
  # EPUBLISHCONFLICT). On a re-run this is expected and safe: the artifact is
  # already published at this version, so continue to verification.
  if echo "$output" | grep -qiE "cannot publish over|previously published version|EPUBLISHCONFLICT"; then
    echo "ℹ️  $package_dir already published at this version; continuing to verification."
    return 0
  fi

  return 1
}

# Verify that the published version is assigned to the EXPECTED dist-tag.
# Mirrors the check for both `latest` and `beta`: dist_tags[expected_tag] must
# equal the published version. A missing/unreadable response is treated as a
# transient failure and retried (it must never count as a pass).
verify_dist_tags() {
  local package_name=$1
  local version=$2
  local expected_tag=$3

  echo "Verifying dist-tags for $package_name (expecting $expected_tag=$version)..."

  # Retry logic for npm registry propagation (configurable for testing).
  local max_attempts=${DIST_TAG_VERIFY_MAX_ATTEMPTS:-6}
  local attempt=1
  local delay=${DIST_TAG_VERIFY_BASE_DELAY:-5}

  while [ $attempt -le $max_attempts ]; do
    echo "Attempt $attempt/$max_attempts: Checking dist-tags..."

    local dist_tags tag_value
    dist_tags=$(npm view "$package_name" dist-tags --json --registry https://registry.npmjs.org 2>/dev/null || echo "")

    # Extract the value of the expected tag. An empty/unparseable response or a
    # missing tag yields 'none', which never equals a real version, so a read
    # failure correctly fails (or retries) rather than passing.
    tag_value="none"
    if [ -n "$dist_tags" ]; then
      tag_value=$(printf '%s' "$dist_tags" | node -e "try { const t = JSON.parse(require('fs').readFileSync(0,'utf8')); process.stdout.write(String(t['$expected_tag'] || 'none')); } catch { process.stdout.write('none'); }")
    fi

    if [ "$tag_value" = "$version" ]; then
      echo "✓ Dist-tag '$expected_tag' correctly points to $version for $package_name"
      return 0
    fi

    if [ $attempt -eq $max_attempts ]; then
      echo "ERROR: After $max_attempts attempts, dist-tag '$expected_tag' for $package_name is '$tag_value', expected '$version'"
      local alert_message="CRITICAL: Package $package_name version $version is not assigned to the '$expected_tag' dist-tag (got '$tag_value'). Manual verification needed."
      if [ -n "${GITHUB_ACTIONS:-}" ]; then
        echo "::error::$alert_message"
      fi
      echo "🚨 ALERT: $alert_message"
      echo "ℹ️  This may be a temporary NPM registry issue. Manual investigation recommended."
      return 1
    fi

    echo "Registry not updated yet, waiting ${delay}s before retry..."
    sleep $delay
    delay=$((delay * 2))  # Exponential backoff
    attempt=$((attempt + 1))
  done
}

main() {
  # 1) Pre-flight: validate all packages before publishing anything.
  if ! preflight_validate; then
    echo "ERROR: Pre-flight validation failed. Aborting release before any publish (no packages were published)."
    exit 1
  fi

  local tag
  tag=$(publish_tag)

  # 2) Publish + verify each package.
  local package_dir version package_name
  for package_dir in "${TARGET_PACKAGES[@]}"; do
    [ -d "$package_dir" ] || continue
    echo "Publishing package in $package_dir"

    version=$(read_pkg_field "$package_dir" "version")
    package_name=$(read_pkg_field "$package_dir" "name")

    if ! publish_package "$package_dir" "$tag"; then
      echo "ERROR: Failed to publish $package_name"
      FAILED=1
      continue
    fi

    # Verify dist-tags after publish (unless explicitly skipped).
    if [ "${SKIP_DIST_TAG_VERIFY:-}" != "1" ]; then
      verify_dist_tags "$package_name" "$version" "$tag" || FAILED=1
    fi
  done

  if [ "$FAILED" -ne 0 ]; then
    echo "ERROR: One or more packages failed to publish or verify"
    exit 1
  fi
}

# Only run main if executed directly (not when sourced by tests).
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
