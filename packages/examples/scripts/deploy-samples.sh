#!/bin/bash

set -e

echo "Reading examples catalog and dispatching individual workflows..."

while IFS= read -r line; do
    name=$(echo "$line" | jq -r '.name')
    handler=$(echo "$line" | jq -r '.handler')
    
    echo "Dispatching workflow for: $name"
    
    gh workflow run deploy-test-example.yml \
      -f example_name="$name" \
      -f handler="$handler"
      
done < <(jq -c '.examples[]' examples-catalog.json)

echo "All workflows dispatched!"
