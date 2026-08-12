#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIRECTORY=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TEST_DIRECTORY=$(mktemp -d)
trap 'rm -rf "$TEST_DIRECTORY"' EXIT

mkdir -p \
  "$TEST_DIRECTORY/sdk/package/dist-cjs" \
  "$TEST_DIRECTORY/otel/package/dist-cjs"

cat > "$TEST_DIRECTORY/sdk/package/package.json" <<'JSON'
{
  "name": "@example/sdk",
  "version": "1.0.0",
  "main": "./dist-cjs/index.js"
}
JSON
printf "module.exports = { sdk: true };\n" \
  > "$TEST_DIRECTORY/sdk/package/dist-cjs/index.js"

cat > "$TEST_DIRECTORY/otel/package/package.json" <<'JSON'
{
  "name": "@example/sdk-otel",
  "version": "1.0.0",
  "main": "./dist-cjs/index.js",
  "peerDependencies": {
    "@opentelemetry/api": "^1.0.0"
  }
}
JSON
printf "module.exports = { plugin: true };\n" \
  > "$TEST_DIRECTORY/otel/package/dist-cjs/index.js"

cat > "$TEST_DIRECTORY/package-lock.json" <<'JSON'
{
  "name": "fixture",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "fixture",
      "version": "1.0.0"
    },
    "packages/sdk": {
      "name": "@example/sdk",
      "version": "1.0.0"
    }
  }
}
JSON

tar -czf "$TEST_DIRECTORY/sdk.tgz" -C "$TEST_DIRECTORY/sdk" package
tar -czf "$TEST_DIRECTORY/otel.tgz" -C "$TEST_DIRECTORY/otel" package

for BUILD in first second; do
  bash "$SCRIPT_DIRECTORY/build-layer.sh" \
    "$TEST_DIRECTORY/sdk.tgz" \
    "$TEST_DIRECTORY/otel.tgz" \
    "$TEST_DIRECTORY/package-lock.json" \
    "$TEST_DIRECTORY/$BUILD-layer" \
    "$TEST_DIRECTORY/$BUILD.zip"
done

FIRST_HASH=$(sha256sum "$TEST_DIRECTORY/first.zip" | cut -d' ' -f1)
SECOND_HASH=$(sha256sum "$TEST_DIRECTORY/second.zip" | cut -d' ' -f1)
test "$FIRST_HASH" = "$SECOND_HASH"

unzip -t "$TEST_DIRECTORY/first.zip" >/dev/null
unzip -Z1 "$TEST_DIRECTORY/first.zip" |
  grep -q '^nodejs/node_modules/@aws/durable-execution-sdk-js/package.json$'
unzip -Z1 "$TEST_DIRECTORY/first.zip" |
  grep -q '^nodejs/node_modules/@aws/durable-execution-sdk-js-otel/package.json$'
if unzip -Z1 "$TEST_DIRECTORY/first.zip" |
  grep -q '^nodejs/node_modules/.package-lock.json$'; then
  echo "The layer unexpectedly contains npm's generated hidden lockfile." >&2
  exit 1
fi
if unzip -Z1 "$TEST_DIRECTORY/first.zip" |
  grep -q '^nodejs/node_modules/@opentelemetry/'; then
  echo "The layer unexpectedly contains OpenTelemetry packages." >&2
  exit 1
fi
