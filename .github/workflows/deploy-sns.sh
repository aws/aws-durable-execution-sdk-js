#!/bin/bash
# Deploy SNS infrastructure for npm publish alerts

set -e

STACK_NAME="npm-publish-alerts"
TEMPLATE_FILE=".github/workflows/sns-setup.yaml"

echo "Deploying SNS infrastructure..."

aws cloudformation deploy \
  --template-file "$TEMPLATE_FILE" \
  --stack-name "$STACK_NAME" \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1

echo "Getting stack outputs..."
TOPIC_ARN=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs[?OutputKey==`TopicArn`].OutputValue' \
  --output text \
  --region us-east-1)

ROLE_ARN=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs[?OutputKey==`RoleArn`].OutputValue' \
  --output text \
  --region us-east-1)

echo "Setup complete!"
echo "Add these to GitHub repository secrets:"
echo "AWS_ROLE_ARN=$ROLE_ARN"
echo "AWS_SNS_TOPIC_ARN=$TOPIC_ARN"
echo "ONCALL_PAGE_ALIAS=your-team-oncall-alias"