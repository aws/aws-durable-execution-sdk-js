#!/bin/bash
# End-to-end scenarios for iterate-publish-npm.sh, run against fixture packages
# with the registry-aware mock npm on PATH. Exits non-zero if any scenario fails.
#
#   PATH must include the dir containing the mock `npm` (the workflow sets this).
set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../../../.." && pwd)
PUBLISH="$REPO_ROOT/.github/workflows/iterate-publish-npm.sh"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
export DIST_TAG_VERIFY_ATTEMPTS=${DIST_TAG_VERIFY_ATTEMPTS:-2}
export DIST_TAG_VERIFY_DELAY=${DIST_TAG_VERIFY_DELAY:-1}

FAILS=0
pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILS=$((FAILS + 1)); }

# mkpkg <dir> <name> <version>
mkpkg() {
  mkdir -p "$1"
  printf '{"name":"%s","version":"%s"}\n' "$2" "$3" > "$1/package.json"
}

# fresh <name> -> sets PKG_DIR, NPM_LOG, MOCK_REGISTRY for a scenario
fresh() {
  PKG_DIR="$WORK/$1"; mkdir -p "$PKG_DIR"
  export NPM_LOG="$WORK/$1.log"; : > "$NPM_LOG"
  export MOCK_REGISTRY="$WORK/$1.reg.json"; echo '{}' > "$MOCK_REGISTRY"
}

# logged_tag_is <expected-tag> : true if a publish with that --tag was recorded
logged_tag_is() { grep -q "\"publish\".*\"--tag\",\"$1\"" "$NPM_LOG"; }
no_publish()    { ! grep -q '"publish"' "$NPM_LOG"; }
reg_latest()    { node -e 'const r=JSON.parse(require("fs").readFileSync(process.env.MOCK_REGISTRY,"utf8"));process.stdout.write((r[process.argv[1]]&&r[process.argv[1]].distTags&&r[process.argv[1]].distTags.latest)||"")' "$1"; }

echo "1) forward stable release -> latest"
fresh s1
mkpkg "$PKG_DIR" core 2.0.0
echo '{"core":{"distTags":{"latest":"1.9.0"},"versions":["1.9.0"]}}' > "$MOCK_REGISTRY"
if TEST_PACKAGES="$PKG_DIR" bash "$PUBLISH" >/dev/null 2>&1 && logged_tag_is latest && [ "$(reg_latest core)" = "2.0.0" ]; then
  pass "2.0.0 published to latest; latest moved to 2.0.0"
else fail "forward release did not go to latest"; fi

echo "2) backport below latest -> v<major>, latest unchanged"
fresh s2
mkpkg "$PKG_DIR" core 1.1.9
echo '{"core":{"distTags":{"latest":"2.0.0"},"versions":["2.0.0"]}}' > "$MOCK_REGISTRY"
if TEST_PACKAGES="$PKG_DIR" bash "$PUBLISH" >/dev/null 2>&1 && logged_tag_is v1 && [ "$(reg_latest core)" = "2.0.0" ]; then
  pass "1.1.9 published to v1; latest still 2.0.0"
else fail "backport did not go to v1 / moved latest"; fi

echo "3) prerelease above latest -> beta"
fresh s3
mkpkg "$PKG_DIR" core 3.0.0-beta.1
echo '{"core":{"distTags":{"latest":"2.0.0"},"versions":["2.0.0"]}}' > "$MOCK_REGISTRY"
if TEST_PACKAGES="$PKG_DIR" bash "$PUBLISH" >/dev/null 2>&1 && logged_tag_is beta; then
  pass "3.0.0-beta.1 published to beta"
else fail "prerelease above latest did not go to beta"; fi

echo "4) old-line prerelease -> reject, nothing published"
fresh s4
mkpkg "$PKG_DIR" core 1.5.0-beta.1
echo '{"core":{"distTags":{"latest":"2.0.0"},"versions":["2.0.0"]}}' > "$MOCK_REGISTRY"
if ! TEST_PACKAGES="$PKG_DIR" bash "$PUBLISH" >/dev/null 2>&1 && no_publish; then
  pass "old-line prerelease rejected before any publish"
else fail "old-line prerelease was not rejected"; fi

echo "5) already-published version -> skip"
fresh s5
mkpkg "$PKG_DIR" core 2.0.0
echo '{"core":{"distTags":{"latest":"2.0.0"},"versions":["1.0.0","2.0.0"]}}' > "$MOCK_REGISTRY"
if TEST_PACKAGES="$PKG_DIR" bash "$PUBLISH" >/dev/null 2>&1 && no_publish; then
  pass "already-published version skipped (idempotent)"
else fail "already-published version was not skipped"; fi

echo "6) registry read failure -> abort, nothing published"
fresh s6
mkpkg "$PKG_DIR" core 2.0.0
if ! MOCK_VIEW_FAIL=1 TEST_PACKAGES="$PKG_DIR" bash "$PUBLISH" >/dev/null 2>&1 && no_publish; then
  pass "aborted on registry read failure"
else fail "did not abort on registry read failure"; fi

echo "7) post-publish tag/version mismatch -> fail"
fresh s7
mkpkg "$PKG_DIR" core 2.0.0
echo '{"core":{"distTags":{"latest":"1.9.0"},"versions":["1.9.0"]}}' > "$MOCK_REGISTRY"
if ! MOCK_BREAK_VERIFY=1 TEST_PACKAGES="$PKG_DIR" bash "$PUBLISH" >/dev/null 2>&1; then
  pass "post-publish verification caught the mismatch"
else fail "post-publish mismatch was not detected"; fi

echo
if [ "$FAILS" -ne 0 ]; then echo "E2E FAILED: $FAILS scenario(s)"; exit 1; fi
echo "E2E PASSED: all scenarios"
