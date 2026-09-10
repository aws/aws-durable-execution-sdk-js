#!/usr/bin/env bash
#
# Deploy the Bedrock support-agent example as a real durable Lambda function.
# Re-runnable: creates the role+function+policies if absent, updates code if present.
# Modeled on the package's cloud/deploy.sh, plus a Bedrock InvokeModel inline policy.
#
# Credentials note: this script does not manage credentials. Export standard AWS credentials
# (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN) however your environment does
# it. If your ~/.aws is not writable, write them to a file as `KEY=value` lines and point
# $AWS_ENV_FILE at it; every aws call below is prefixed with `env $(cat "$AWS_ENV_FILE")`.
#
# Node note: if your host's native node is too old to run this repo (needs >=22), all node work
# below runs inside the node:22 Docker container, so only Docker is required.
#
# Usage:
#   AWS_ACCOUNT_ID=<your-account-id> \
#     packages/aws-durable-execution-sdk-js-graph/examples/bedrock-support-agent/cloud/deploy.sh
#
set -euo pipefail

ACCOUNT=${AWS_ACCOUNT_ID:?set AWS_ACCOUNT_ID to the target account}
REGION=${AWS_REGION:-us-east-1}
ROLE=bedrock-support-agent-role
FN=bedrock-support-agent
AWS_ENV_FILE=${AWS_ENV_FILE:-/dev/null}
POLICY_DURABLE=arn:aws:iam::aws:policy/service-role/AWSLambdaBasicDurableExecutionRolePolicy
POLICY_BASIC=arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
BEDROCK_POLICY_NAME=bedrock-invoke-model

# Resolve repo root (five levels up from this cloud/ dir) so Docker can mount it.
CLOUD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$CLOUD_DIR/../../../../.." && pwd)"
BUNDLE_REL="packages/aws-durable-execution-sdk-js-graph/examples/bedrock-support-agent/cloud/bundle.mjs"

aws_() { env $(cat "$AWS_ENV_FILE") aws "$@" --region "$REGION"; }
docker_node() {
  docker run --rm -v "$REPO_ROOT":/w -w /w -u "$(id -u):$(id -g)" -e HOME=/tmp node:22 "$@"
}

echo ">>> [1/7] Bundle handler with esbuild (node:22 docker)"
docker_node node "$BUNDLE_REL"

echo ">>> [2/7] Zip bundle"
( cd "$CLOUD_DIR/build" && rm -f ../function.zip && zip -q -r ../function.zip index.js )
echo "    zip bytes: $(stat -c %s "$CLOUD_DIR/function.zip")"

echo ">>> [3/7] Ensure IAM role"
if ! aws_ iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  cat > /tmp/bsa-trust-policy.json <<'JSON'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}
JSON
  aws_ iam create-role --role-name "$ROLE" \
    --assume-role-policy-document file:///tmp/bsa-trust-policy.json \
    --description "Bedrock support-agent example role (safe to delete)" >/dev/null
fi
aws_ iam attach-role-policy --role-name "$ROLE" --policy-arn "$POLICY_DURABLE" >/dev/null 2>&1 || true
aws_ iam attach-role-policy --role-name "$ROLE" --policy-arn "$POLICY_BASIC" >/dev/null 2>&1 || true

echo ">>> [4/7] Attach Bedrock InvokeModel inline policy"
# The inference-profile id fans out to underlying foundation models across regions, so BOTH the
# foundation-model and inference-profile resources are required (brief: verified env facts).
cat > /tmp/bsa-bedrock-policy.json <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow",
  "Action":["bedrock:InvokeModel","bedrock:InvokeModelWithResponseStream"],
  "Resource":[
    "arn:aws:bedrock:*::foundation-model/*",
    "arn:aws:bedrock:*:${ACCOUNT}:inference-profile/*"
  ]}]}
JSON
aws_ iam put-role-policy --role-name "$ROLE" \
  --policy-name "$BEDROCK_POLICY_NAME" \
  --policy-document file:///tmp/bsa-bedrock-policy.json >/dev/null
ROLE_ARN="arn:aws:iam::${ACCOUNT}:role/${ROLE}"
echo "    role: $ROLE_ARN"

echo ">>> [5/7] Create or update function"
if aws_ lambda get-function --function-name "$FN" >/dev/null 2>&1; then
  aws_ lambda update-function-code --function-name "$FN" \
    --zip-file "fileb://$CLOUD_DIR/function.zip" >/dev/null
  aws_ lambda wait function-updated --function-name "$FN"
else
  for attempt in 1 2 3 4 5; do
    if aws_ lambda create-function --function-name "$FN" \
        --runtime nodejs22.x --role "$ROLE_ARN" --handler index.handler \
        --zip-file "fileb://$CLOUD_DIR/function.zip" \
        --durable-config '{"ExecutionTimeout": 900, "RetentionPeriodInDays": 1}' \
        --timeout 60 --memory-size 512 >/dev/null 2>/tmp/bsa-create.err; then
      break
    fi
    echo "    create attempt $attempt failed (likely IAM propagation); retrying in 10s"
    cat /tmp/bsa-create.err | tail -2
    sleep 10
  done
  aws_ lambda wait function-active --function-name "$FN"
fi

echo ">>> [6/7] Publish version"
VER=$(aws_ lambda publish-version --function-name "$FN" --query 'Version' --output text)
echo "    published version: $VER"

echo ">>> [7/7] Done"
echo "FUNCTION_ARN=arn:aws:lambda:${REGION}:${ACCOUNT}:function:${FN}:${VER}"
