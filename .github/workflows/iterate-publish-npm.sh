#!/bin/bash
set -uo pipefail

PRERELEASE=${1:-false}
FAILED=0

for package_dir in packages/*; do
  if [ -d "$package_dir" ] && [[ "$package_dir" == "packages/aws-durable-execution-sdk-js-testing" || "$package_dir" == "packages/aws-durable-execution-sdk-js" || "$package_dir" == "packages/aws-durable-execution-sdk-js-eslint-plugin" ]]; then
    echo "Publishing package in $package_dir";
    cd "$package_dir";
    if [ "$PRERELEASE" = "true" ]; then
      npm publish --access public --tag beta || FAILED=1
    else
      npm publish --access public || FAILED=1
    fi
    cd ../..;
  fi
done

if [ "$FAILED" -ne 0 ]; then
  echo "ERROR: One or more packages failed to publish"
  exit 1
fi
