# Handling Pull Requests from Forked Repositories

This guide outlines the process for reviewing and testing PRs from forked repositories, which require special handling due to security restrictions.

## Security Considerations

⚠️ **CRITICAL: Security Review Required**

Before approving any workflows for forked PRs, carefully review the code changes for:

- **Secret exposure attempts**: Code that tries to print, log, or transmit environment variables, secrets, or credentials
- **Malicious network requests**: Unauthorized API calls or data exfiltration attempts
- **File system access**: Attempts to read sensitive files or configuration
- **Process execution**: Suspicious shell commands or script execution
- **Dependency injection**: New dependencies that could contain malicious code

**Never approve workflows without thorough code review first.**

## Review Process

### 1. Code Security Review

1. Carefully examine all changed files
2. Look for any attempts to access `process.env`, `secrets.*`, or `vars.*`
3. Check for suspicious network requests or file operations
4. Verify new dependencies are legitimate and necessary
5. Ensure no code attempts to expose or steal secrets

### 2. Approve Unit Tests

Once security review is complete:

1. Go to the PR's "Checks" tab
2. Click "Approve and run" for unit tests only
3. Wait for unit tests to pass before proceeding

### 3. Run Integration Tests Locally

Since integration tests are automatically skipped for forked PRs (they require AWS secrets), you must run them locally.

#### Prerequisites

```bash
# Install dependencies
npm ci

# Build the project
npm run build
```

#### AWS Setup

Configure AWS credentials with permissions for:

- Lambda functions (create, invoke, delete)
- CloudWatch Logs (create, delete log groups)
- IAM role for Lambda execution

```bash
# Option 1: AWS CLI
aws configure

# Option 2: Environment variables
export AWS_ACCESS_KEY_ID=your_key
export AWS_SECRET_ACCESS_KEY=your_secret
export AWS_REGION=us-east-1
```

#### Pull and Test the PR

```bash
# Fetch the PR branch
git fetch origin pull/PR_NUMBER/head:pr-branch-name
git checkout pr-branch-name

# Rebuild with PR changes
npm run build

# Run integration tests
node .github/workflows/scripts/integration-test/integration-test.js --runtime 22.x

# Or run step by step:
# 1. Deploy functions
node .github/workflows/scripts/integration-test/integration-test.js --deploy-only --runtime 22.x

# 2. Run tests
node .github/workflows/scripts/integration-test/integration-test.js --test-only --runtime 22.x

# 3. Cleanup (important!)
node .github/workflows/scripts/integration-test/integration-test.js --cleanup-only --runtime 22.x
```

#### Alternative: Examples Package Tests

```bash
cd packages/aws-durable-execution-sdk-js-examples
npm run test:integration
```

### 4. Approval Decision

Only approve the PR if:

- ✅ Security review passed (no malicious code)
- ✅ Unit tests passed
- ✅ Integration tests passed locally
- ✅ Code quality meets project standards

## Why This Process Exists

GitHub Actions automatically restricts access to repository secrets for PRs from forked repositories. This prevents:

- Malicious actors from accessing AWS credentials
- Accidental exposure of sensitive information
- Unauthorized resource usage

Our CI automatically skips integration tests for forked PRs using this condition:

```yaml
if: github.event.pull_request.head.repo.full_name == github.repository || github.event_name != 'pull_request'
```
