#!/bin/bash
set -e

# Deploy Lambda Function Script
# Usage: ./deploy-lambda.sh <example-name> [function-name]

if [ $# -lt 1 ] || [ $# -gt 2 ]; then
    echo "Usage: $0 <example-name> [function-name]"
    echo "Example: $0 hello-world"
    echo "Example: $0 hello-world custom-function-name"
    exit 1
fi

EXAMPLE="$1"
FUNCTION_NAME="${2:-$EXAMPLE}"

# Source environment variables
set -a
if [ -n "$GITHUB_ACTIONS" ]; then
    # Running in GitHub Actions - don't source .secrets
    :
else
    source ../../.secrets 2>/dev/null || echo "Warning: .secrets file not found"
fi
set +a

# Required environment variables
: ${AWS_ACCOUNT_ID:?AWS_ACCOUNT_ID is required}
: ${LAMBDA_ENDPOINT:?LAMBDA_ENDPOINT is required}
: ${INVOKE_ACCOUNT_ID:?INVOKE_ACCOUNT_ID is required}
: ${AWS_REGION:=us-west-2}

# Get configuration from examples-catalog.json
CATALOG_FILE="examples-catalog.json"
if [ ! -f "$CATALOG_FILE" ]; then
    echo "Error: $CATALOG_FILE not found"
    exit 1
fi

# Find example in catalog and extract config
EXAMPLE_CONFIG=$(jq -r --arg handler "$EXAMPLE.handler" '.examples[] | select(.handler == $handler)' "$CATALOG_FILE")
if [ -z "$EXAMPLE_CONFIG" ]; then
    echo "Error: Example with handler '$EXAMPLE.handler' not found in $CATALOG_FILE"
    echo "Available handlers:"
    jq -r '.examples[].handler' "$CATALOG_FILE"
    exit 1
fi

HANDLER=$(echo "$EXAMPLE_CONFIG" | jq -r '.handler')
RETENTION_DAYS=$(echo "$EXAMPLE_CONFIG" | jq -r '.durableConfig.RetentionPeriodInDays')
EXECUTION_TIMEOUT=$(echo "$EXAMPLE_CONFIG" | jq -r '.durableConfig.ExecutionTimeout')
DESCRIPTION=$(echo "$EXAMPLE_CONFIG" | jq -r '.description')
EXAMPLE_NAME=$(echo "$EXAMPLE_CONFIG" | jq -r '.name')

echo "Found example configuration:"
echo "  Name: $EXAMPLE_NAME"
echo "  Function Name: $FUNCTION_NAME"
echo "  Handler: $HANDLER"
echo "  Description: $DESCRIPTION"
echo "  Retention: $RETENTION_DAYS days"
echo "  Timeout: $EXECUTION_TIMEOUT seconds"

# Validate zip file exists
ZIP_FILE="$EXAMPLE.zip"
if [ ! -f "$ZIP_FILE" ]; then
    echo "Error: $ZIP_FILE not found. Please build and package first."
    echo "Run: npm run build && npm run package -- $EXAMPLE"
    exit 1
fi

ROLE_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:role/DurableFunctionsIntegrationTestRole"

echo "Checking if function exists..."

if aws lambda get-function --function-name "$FUNCTION_NAME" --endpoint-url "$LAMBDA_ENDPOINT" --region "$AWS_REGION" >/dev/null 2>&1; then
    # Get current config to show existing settings
    CURRENT_CONFIG=$(aws lambda get-function-configuration \
        --function-name "$FUNCTION_NAME" \
        --endpoint-url "$LAMBDA_ENDPOINT" \
        --region "$AWS_REGION" \
        --output json)
    
    CURRENT_RETENTION=$(echo "$CURRENT_CONFIG" | jq -r '.DurableConfig.RetentionPeriodInDays // "none"')
    CURRENT_TIMEOUT=$(echo "$CURRENT_CONFIG" | jq -r '.DurableConfig.ExecutionTimeout // "none"')
    
    echo "Function exists with current DurableConfig:"
    echo "  Current Retention: $CURRENT_RETENTION days"
    echo "  Current Timeout: $CURRENT_TIMEOUT seconds"
    echo "  Target Retention: $RETENTION_DAYS days"
    echo "  Target Timeout: $EXECUTION_TIMEOUT seconds"
    
    echo "Deploying function: $FUNCTION_NAME (updating existing)"
    echo "Updating function code..."
    aws lambda update-function-code \
        --function-name "$FUNCTION_NAME" \
        --zip-file fileb://"$ZIP_FILE" \
        --endpoint-url "$LAMBDA_ENDPOINT" \
        --region "$AWS_REGION"

    # Update environment variables
    echo "Updating environment variables..."
    aws lambda update-function-configuration \
        --function-name "$FUNCTION_NAME" \
        --environment Variables="{AWS_ENDPOINT_URL_LAMBDA=$LAMBDA_ENDPOINT}" \
        --kms-key-arn "$KMS_KEY_ARN" \
        --endpoint-url "$LAMBDA_ENDPOINT" \
        --region "$AWS_REGION" \
        --output json

    # Check if DurableConfig needs updating
    if [ "$CURRENT_RETENTION" != "$RETENTION_DAYS" ] || [ "$CURRENT_TIMEOUT" != "$EXECUTION_TIMEOUT" ]; then
        echo "DurableConfig differs, updating configuration..."
        aws lambda update-function-configuration \
            --function-name "$FUNCTION_NAME" \
            --durable-config RetentionPeriodInDays=$RETENTION_DAYS,ExecutionTimeout=$EXECUTION_TIMEOUT \
            --endpoint-url "$LAMBDA_ENDPOINT" \
            --region "$AWS_REGION" \
            --output json
    else
        echo "DurableConfig is up to date"
    fi
else
    echo "Function does not exist"
    echo "Deploying function: $FUNCTION_NAME (creating new)"
    aws lambda create-function \
        --function-name "$FUNCTION_NAME" \
        --runtime nodejs22.x \
        --role "$ROLE_ARN" \
        --handler "$HANDLER" \
        --description "$DESCRIPTION" \
        --zip-file fileb://"$ZIP_FILE" \
        --durable-config RetentionPeriodInDays=$RETENTION_DAYS,ExecutionTimeout=$EXECUTION_TIMEOUT \
        --timeout 60 \
        --memory-size 128 \
        --environment Variables="{AWS_ENDPOINT_URL_LAMBDA=$LAMBDA_ENDPOINT}" \
        --kms-key-arn "$KMS_KEY_ARN" \
        --endpoint-url "$LAMBDA_ENDPOINT" \
        --region "$AWS_REGION" \
        --output json
fi

# Add resource policy for the invoke account to invoke the function
echo "Checking resource policy..."
if aws lambda get-policy \
    --function-name "$FUNCTION_NAME" \
    --endpoint-url "$LAMBDA_ENDPOINT" \
    --region "$AWS_REGION" \
    --output text \
    --query 'Policy' 2>/dev/null | grep -q "dex-invoke-permission"; then
    echo "Resource policy already exists, skipping"
else
    echo "Adding resource policy to invoke function..."
    aws lambda add-permission \
        --function-name "$FUNCTION_NAME" \
        --statement-id "dex-invoke-permission" \
        --action "lambda:InvokeFunction" \
        --principal "$INVOKE_ACCOUNT_ID" \
        --endpoint-url "$LAMBDA_ENDPOINT" \
        --region "$AWS_REGION" \
        --output json
    echo "Resource policy added successfully"
fi

# Set GITHUB_ENV only if running in GitHub Actions
if [ -n "$GITHUB_ENV" ]; then
    echo "FUNCTION_NAME=$FUNCTION_NAME" >> $GITHUB_ENV
fi

echo "Successfully deployed function: $FUNCTION_NAME"

# Show the function configuration to verify DurableConfig
echo "Function configuration:"
aws lambda get-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --endpoint-url "$LAMBDA_ENDPOINT" \
    --region "$AWS_REGION" \
    --output json

echo "Deployment completed successfully!"
