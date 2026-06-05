#!/bin/bash
set -uo pipefail

# Publishes each package to npm, choosing the dist-tag from the VERSION itself
# (the GitHub Release "prerelease" checkbox is intentionally ignored). The
# current `latest` on the registry is the reference point:
#
#   stable, version >  latest   -> latest            (move latest forward)
#   stable, version <  latest   -> v<major>          (backport line tag; latest unchanged)
#   prerelease, version > latest-> beta              (prerelease of a future line)
#   prerelease, version <= latest -> REJECT          (no betas for old/shipped lines)
#   version already published   -> skip              (idempotent re-run)
#   no latest yet (first publish)-> latest / beta by version
#
# This keeps `latest` always pointing at the highest released line while v1/v2
# are maintained in parallel. The decision logic lives in (and is unit-tested
# via) scripts/test-publish/decide-dist-tag.js.

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DECIDE="$SCRIPT_DIR/scripts/test-publish/decide-dist-tag.js"

# Packages to publish. Tests override this with TEST_PACKAGES (space-separated).
if [ -n "${TEST_PACKAGES:-}" ]; then
  read -ra PACKAGES <<< "$TEST_PACKAGES"
else
  PACKAGES=(
    "packages/aws-durable-execution-sdk-js"
    "packages/aws-durable-execution-sdk-js-testing"
    "packages/aws-durable-execution-sdk-js-eslint-plugin"
  )
fi

pkg_field() {
  node -e 'process.stdout.write(String(require(require("path").resolve(process.argv[1], "package.json"))[process.argv[2]]))' "$1" "$2"
}

# Fetch the packument (`npm view <name> --json`). Prints the JSON on success,
# prints empty for a brand-new (never-published, E404) package, and returns
# non-zero ONLY on a genuine read failure (network/registry) so the caller can
# abort rather than guess.
fetch_packument() {
  local name=$1 errfile out status err
  errfile=$(mktemp)
  out=$(npm view "$name" --json 2>"$errfile"); status=$?
  err=$(cat "$errfile"); rm -f "$errfile"
  if [ $status -eq 0 ]; then printf '%s' "$out"; return 0; fi
  if printf '%s' "$err" | grep -qiE "E404|404 Not Found"; then
    printf ''; return 0   # package not published yet
  fi
  echo "ERROR: failed to read registry state for $name: $err" >&2
  return 1
}

# Parallel arrays describing what we will do, filled by the pre-flight pass.
P_DIR=(); P_NAME=(); P_VER=(); P_TAG=()

# ---------- PRE-FLIGHT: decide for every package before publishing anything ----------
for dir in "${PACKAGES[@]}"; do
  [ -d "$dir" ] || continue
  name=$(pkg_field "$dir" name)
  version=$(pkg_field "$dir" version)

  if ! packument=$(fetch_packument "$name"); then
    echo "ERROR: aborting release; could not determine current 'latest' for $name (no packages published)."
    exit 1
  fi

  if ! decision=$(node "$DECIDE" "$version" "$packument"); then
    echo "ERROR: could not decide a dist-tag for $name@$version (invalid version in package.json?)."
    echo "       Aborting before any publish (nothing was published)."
    exit 1
  fi
  case "$decision" in
    reject)
      echo "ERROR: $name@$version violates the release policy (a prerelease must be greater than the current 'latest')."
      echo "       Aborting before any publish (nothing was published)."
      exit 1
      ;;
    skip)   echo "Plan: $name@$version -> already published; will skip" ;;
    latest) echo "Plan: $name@$version -> 'latest'" ;;
    beta)   echo "Plan: $name@$version -> 'beta'" ;;
    *)      echo "Plan: $name@$version -> '$decision' (backport line tag; 'latest' unchanged)" ;;
  esac

  P_DIR+=("$dir"); P_NAME+=("$name"); P_VER+=("$version"); P_TAG+=("$decision")
done

# ---------- PUBLISH + POST-PUBLISH verification ----------
FAILED=0
for i in "${!P_DIR[@]}"; do
  dir=${P_DIR[$i]}; name=${P_NAME[$i]}; version=${P_VER[$i]}; tag=${P_TAG[$i]}

  if [ "$tag" = "skip" ]; then
    echo "Skipping $name@$version (already published)."
    continue
  fi

  echo "Publishing $name@$version to '$tag'"
  if ! (cd "$dir" && npm publish --access public --tag "$tag"); then
    echo "ERROR: failed to publish $name@$version"
    FAILED=1
    continue
  fi

  # Tests (and any caller) can skip the registry round-trip.
  [ "${SKIP_DIST_TAG_VERIFY:-}" = "1" ] && continue

  # Confirm the dist-tag we targeted now points at the published version.
  # Fixed retries cover npm registry propagation lag (tunable for tests).
  attempts=${DIST_TAG_VERIFY_ATTEMPTS:-5}
  delay=${DIST_TAG_VERIFY_DELAY:-10}
  ok=0
  for ((a = 1; a <= attempts; a++)); do
    published=$(npm view "$name" "dist-tags.$tag" 2>/dev/null || echo "")
    if [ "$published" = "$version" ]; then
      echo "OK: $name '$tag' -> $version confirmed"
      ok=1
      break
    fi
    echo "  not visible yet ($tag='$published'); attempt $a/$attempts"
    [ "$a" -lt "$attempts" ] && sleep "$delay"
  done
  if [ "$ok" -ne 1 ]; then
    echo "ERROR: $name '$tag' does not point to $version after $attempts attempts"
    FAILED=1
  fi
done

if [ "$FAILED" -ne 0 ]; then
  echo "ERROR: one or more packages failed to publish or verify"
  exit 1
fi
echo "All packages published and verified."
