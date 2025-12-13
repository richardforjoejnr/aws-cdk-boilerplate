# Troubleshooting Guide

## Common Issues and Solutions

### Orphaned Resources (Most Common Issue)

#### Problem
```
Error: Resource of type 'AWS::DynamoDB::Table' with identifier 'prod-main-table' already exists
```

#### Cause
This happens when:
1. A CloudFormation stack fails during deployment
2. The stack is manually deleted from AWS Console
3. Resources with deletion protection remain behind
4. A new deployment tries to create resources with the same name

#### Solution

**Option 1: Use the cleanup script (Recommended)**
```bash
# Cleanup failed stacks and orphaned resources
./scripts/cleanup-failed-stacks.sh prod

# Then retry deployment
STAGE=prod npm run deploy
```

**Option 2: Manual cleanup**
```bash
# 1. Disable deletion protection
aws dynamodb update-table \
  --table-name prod-main-table \
  --no-deletion-protection-enabled

# 2. Delete the table
aws dynamodb delete-table --table-name prod-main-table

# 3. Wait for deletion
aws dynamodb wait table-not-exists --table-name prod-main-table

# 4. Delete any failed stacks
aws cloudformation delete-stack --stack-name prod-aws-boilerplate-database

# 5. Retry deployment
STAGE=prod npm run deploy
```

---

## Prevention Best Practices

### 1. Always Use CDK Commands

**✅ DO THIS:**
```bash
# Deploy
npm run deploy:dev
npm run deploy:prod

# Destroy
STAGE=dev npm run destroy
STAGE=prod npm run destroy
```

**❌ NEVER DO THIS:**
- Don't manually delete CloudFormation stacks from AWS Console
- Don't manually delete resources (tables, functions, etc.) from AWS Console
- Don't force-delete stacks without cleaning up resources first

### 2. Handle Failed Deployments Properly

If a deployment fails:

```bash
# 1. Check the error in CloudFormation console or CLI
aws cloudformation describe-stack-events \
  --stack-name prod-aws-boilerplate-database \
  --max-items 20

# 2. Use the cleanup script
./scripts/cleanup-failed-stacks.sh prod

# 3. Fix the issue in your code

# 4. Retry deployment
npm run deploy:prod
```

### 3. Monitor Stack Status

```bash
# List all stacks and their status
aws cloudformation list-stacks \
  --query 'StackSummaries[?contains(StackName, `aws-boilerplate`)].{Name:StackName, Status:StackStatus}' \
  --output table

# Check for orphaned resources
aws dynamodb list-tables --query 'TableNames[?contains(@, `main-table`)]'
aws lambda list-functions --query 'Functions[?contains(FunctionName, `hello-world`)].FunctionName'
```

### 4. Use Stack Protection Wisely

The project uses deletion protection for prod environments:
```typescript
deletionProtection: isProdLike  // true for prod/test, false for dev
```

**For Production:**
- ✅ Keeps deletion protection enabled
- ✅ Use proper destroy commands
- ✅ Never manually delete protected resources

**For Development:**
- ✅ Deletion protection is disabled for easier iteration
- ✅ Still use CDK destroy commands

---

## Other Common Issues

### Issue: TypeScript Compilation Errors

**Problem:**
```
error TS6133: 'variable' is declared but its value is never read
```

**Solution:**
```bash
# Check for unused variables
npm run build

# Fix or prefix with underscore
const _unusedVar = value;  // TypeScript ignores _ prefix
```

### Issue: CDK Bootstrap Required

**Problem:**
```
Error: This stack uses assets, so the toolkit stack must be deployed
```

**Solution:**
```bash
# Bootstrap CDK (one-time per account/region)
cd packages/infrastructure
npx cdk bootstrap aws://ACCOUNT-ID/us-east-1
```

### Issue: AWS Credentials Not Configured

**Problem:**
```
Error: Missing credentials in config
```

**Solution:**
```bash
# Configure AWS CLI
aws configure

# Or use environment variables
export AWS_ACCESS_KEY_ID=your-key
export AWS_SECRET_ACCESS_KEY=your-secret
export AWS_DEFAULT_REGION=us-east-1

# Or use AWS SSO
aws sso login
```

### Issue: Tests Failing

**Problem:**
```
FAIL src/__tests__/hello-world.test.ts
```

**Solution:**
```bash
# Run tests with verbose output
npm test -- --verbose

# Run specific test file
npm test -- hello-world.test.ts

# Update snapshots if needed
npm test -- -u
```

### Issue: Linting Errors

**Problem:**
```
error  Unsafe assignment of an any value
```

**Solution:**
```bash
# Run linter
npm run lint

# Auto-fix where possible
npx eslint . --ext .ts --fix

# Check specific file
npx eslint path/to/file.ts
```

---

## Debugging Commands

### CloudFormation

```bash
# Get stack status
aws cloudformation describe-stacks --stack-name prod-aws-boilerplate-database

# Get stack events (errors)
aws cloudformation describe-stack-events \
  --stack-name prod-aws-boilerplate-database \
  --max-items 20

# List stack resources
aws cloudformation list-stack-resources \
  --stack-name prod-aws-boilerplate-database
```

### DynamoDB

```bash
# Check if table exists
aws dynamodb describe-table --table-name prod-main-table

# List all tables
aws dynamodb list-tables

# Check table status
aws dynamodb describe-table \
  --table-name prod-main-table \
  --query 'Table.TableStatus'
```

### Lambda

```bash
# List functions
aws lambda list-functions \
  --query 'Functions[?contains(FunctionName, `prod-`)].FunctionName'

# Get function details
aws lambda get-function --function-name prod-hello-world

# Invoke function
aws lambda invoke \
  --function-name prod-hello-world \
  --payload '{"name":"Test"}' \
  response.json && cat response.json
```

### AppSync

```bash
# List GraphQL APIs
aws appsync list-graphql-apis \
  --query 'graphqlApis[?contains(name, `prod-`)].{Name:name, Id:apiId}'

# Get API details
aws appsync get-graphql-api --api-id YOUR_API_ID
```

---

## Emergency Procedures

### Complete Environment Cleanup

If everything is broken and you need to start fresh:

```bash
# 1. Run cleanup script
./scripts/cleanup-failed-stacks.sh prod

# 2. Manually check for orphaned resources
aws dynamodb list-tables
aws lambda list-functions
aws appsync list-graphql-apis

# 3. Delete any remaining orphaned resources
aws dynamodb delete-table --table-name prod-main-table
aws lambda delete-function --function-name prod-hello-world

# 4. Wait a few minutes for deletions to complete

# 5. Redeploy from scratch
npm run deploy:prod
```

### Rollback to Previous Working State

```bash
# 1. Find the last successful git commit
git log --oneline -10

# 2. Check out that commit
git checkout <commit-hash>

# 3. Clean up current deployment
./scripts/cleanup-failed-stacks.sh prod

# 4. Deploy the working version
npm run deploy:prod

# 5. Return to main branch
git checkout main
```

---

## Getting Help

If you're still stuck:

1. **Check CloudFormation Events**: Most detailed error information
   ```bash
   aws cloudformation describe-stack-events --stack-name STACK_NAME
   ```

2. **Check CloudWatch Logs**: For Lambda execution errors
   ```bash
   aws logs tail /aws/lambda/prod-hello-world --follow
   ```

3. **Review Documentation**:
   - [DEPLOYMENT.md](./DEPLOYMENT.md)
   - [AWS_ACCESS_SETUP.md](./AWS_ACCESS_SETUP.md)
   - [CI_CD_SETUP.md](./CI_CD_SETUP.md)

4. **GitHub Issues**: Report bugs at https://github.com/richardforjoejnr/aws-cdk-boilerplate/issues
