#!/bin/bash

set -e

REGION=${AWS_REGION:-us-east-1}
ROLE_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:role/DurableFunctionsIntegrationTestRole"

echo "Packaging Lambda functions..."
cd dist
zip -r ../lambda-functions.zip .
cd ..

echo "Reading examples catalog..."
HANDLERS=$(jq -r '.examples[].handler' examples-catalog.json)

for handler in $HANDLERS; do
    FUNCTION_NAME=$(echo $handler | sed 's/\.handler$//' | sed 's/-/_/g')
    FUNCTION_NAME="${FUNCTION_NAME}_TypeScript"
    
    echo "Deploying function: $FUNCTION_NAME with handler: $handler"
    
    # Try to update existing function, create if it doesn't exist
    if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null 2>&1; then
        echo "Updating existing function: $FUNCTION_NAME"
        aws lambda update-function-code \
            --function-name "$FUNCTION_NAME" \
            --zip-file fileb://lambda-functions.zip \
            --region "$REGION"
    else
        echo "Creating new function: $FUNCTION_NAME"
        aws lambda create-function \
            --function-name "$FUNCTION_NAME" \
            --runtime nodejs22.x \
            --role "$ROLE_ARN" \
            --handler "$handler" \
            --zip-file fileb://lambda-functions.zip \
            --timeout 60 \
            --memory-size 128 \
            --region "$REGION"
    fi
done

echo "Deployment complete!"
