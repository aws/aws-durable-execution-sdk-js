#!/bin/bash

for package_dir in packages/*; do
  if [ -d "$package_dir" ] && [[ "$package_dir" == "packages/aws-durable-execution-sdk-js-testing" || "$package_dir" == "packages/aws-durable-execution-sdk-js" || "$package_dir" == "packages/aws-durable-execution-sdk-js-eslint-plugin" ]]; then
    echo "$package_dir";
    cd "$package_dir";
    echo "Publishing package in $package_dir";
    npm publish --access public;
    cd ../..;
  fi
done
