#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -ne 5 ]; then
  echo "Usage: build-layer.sh <sdk-tarball> <otel-tarball> <source-lock> <layer-directory> <output-zip>" >&2
  exit 2
fi

SDK_PACKAGE=$(realpath "$1")
OTEL_PACKAGE=$(realpath "$2")
SOURCE_LOCK=$(realpath "$3")
LAYER_DIRECTORY=$(node -e \
  'console.log(require("node:path").resolve(process.argv[1]))' "$4")
LAYER_ZIP=$(node -e \
  'console.log(require("node:path").resolve(process.argv[1]))' "$5")
SCRIPT_DIRECTORY=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

if [ -e "$LAYER_DIRECTORY" ] || [ -e "$LAYER_ZIP" ]; then
  echo "Layer output paths must not already exist." >&2
  exit 1
fi

STAGING_DIRECTORY=$(mktemp -d)
trap 'rm -rf "$STAGING_DIRECTORY"' EXIT

mkdir -p "$STAGING_DIRECTORY/sdk" "$STAGING_DIRECTORY/otel"
tar -xzf "$SDK_PACKAGE" -C "$STAGING_DIRECTORY/sdk" --strip-components=1
tar -xzf "$OTEL_PACKAGE" -C "$STAGING_DIRECTORY/otel" --strip-components=1

node "$SCRIPT_DIRECTORY/prepare-runtime-lock.mjs" \
  "$SOURCE_LOCK" \
  "$STAGING_DIRECTORY/sdk/package.json" \
  "$LAYER_DIRECTORY/nodejs"

npm ci \
  --prefix "$LAYER_DIRECTORY/nodejs" \
  --omit=dev \
  --ignore-scripts \
  --legacy-peer-deps \
  --no-audit \
  --no-fund

rm -f "$LAYER_DIRECTORY/nodejs/node_modules/.package-lock.json"

mkdir -p \
  "$LAYER_DIRECTORY/nodejs/node_modules/@aws/durable-execution-sdk-js" \
  "$LAYER_DIRECTORY/nodejs/node_modules/@aws/durable-execution-sdk-js-otel"
cp -a \
  "$STAGING_DIRECTORY/sdk/." \
  "$LAYER_DIRECTORY/nodejs/node_modules/@aws/durable-execution-sdk-js/"
cp -a \
  "$STAGING_DIRECTORY/otel/." \
  "$LAYER_DIRECTORY/nodejs/node_modules/@aws/durable-execution-sdk-js-otel/"

find "$LAYER_DIRECTORY" -type d -exec chmod 755 {} +
find "$LAYER_DIRECTORY" -type f -exec chmod 644 {} +
find "$LAYER_DIRECTORY" -exec touch -t 198001010000 {} +

mkdir -p "$(dirname "$LAYER_ZIP")"
(
  cd "$LAYER_DIRECTORY"
  find nodejs -type f -print |
    LC_ALL=C sort |
    zip -X -q "$LAYER_ZIP" -@
)
