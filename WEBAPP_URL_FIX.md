# Permanent Fix for Web App API URL Issues

## Problem

Web app shows "Error fetching items" because it's connecting to old/deleted API URLs after infrastructure is redeployed.

## Root Cause

When infrastructure is destroyed and redeployed:
1. AppSync creates a **new** GraphQL API with a **new URL**
2. Web app was built with the **old URL** baked into JavaScript
3. CloudFront serves cached version of the old build
4. Web app tries to connect to deleted API → fails

## Complete Permanent Solution

### 1. Automatic Web App Rebuild

**File:** `scripts/deploy-with-cleanup.sh`

**What it does:**
- After deploying infrastructure with `--webapp` flag
- Automatically calls `deploy-webapp.sh` to rebuild and redeploy web app
- Ensures web app always has the current API URL

**Code:**
```bash
# If webapp was deployed, rebuild and redeploy it with updated API endpoints
if [[ "$DEPLOY_WEBAPP" == "--webapp" ]]; then
    ./scripts/deploy-webapp.sh "$STAGE"
fi
```

### 2. Fresh Build Every Time

**File:** `scripts/deploy-webapp.sh`

**What it does:**
```bash
# 1. Configure: Fetch latest API URL from CloudFormation
./scripts/configure-webapp.sh $STAGE

# 2. Clean: Remove old build artifacts
rm -rf dist

# 3. Build: Create fresh build with new API URL
npm run build

# 4. Verify: Display current .env to confirm correct URL
cat .env | grep VITE_GRAPHQL_API_URL

# 5. Deploy: Upload to S3 via CDK
STAGE=$STAGE DEPLOY_WEBAPP=true npx cdk deploy

# 6. Invalidate: Clear CloudFront cache
aws cloudfront create-invalidation --paths "/*"
```

### 3. Configuration Validation

**File:** `scripts/configure-webapp.sh`

**What it does:**
```bash
# Fetch API URL from CloudFormation
API_URL=$(aws cloudformation describe-stacks ...)

# VALIDATE - Exit if URL is missing or invalid
if [ -z "$API_URL" ] || [ "$API_URL" == "None" ]; then
    echo "❌ Error: Could not retrieve API URL"
    exit 1
fi

# Generate .env file
cat > packages/web-app/.env << EOF
VITE_GRAPHQL_API_URL=${API_URL}
VITE_GRAPHQL_API_KEY=${API_KEY}
EOF
```

### 4. Improved Argument Parsing

**File:** `scripts/deploy-with-cleanup.sh`

**What it does:**
```bash
# Properly parse --webapp flag regardless of position
shift # Remove first argument (stage)
for arg in "$@"; do
    case $arg in
        --webapp)
            DEPLOY_WEBAPP="--webapp"
            ;;
    esac
done
```

**Before:** `./deploy.sh dev --webapp` → `DEPLOY_WEBAPP` was in wrong variable
**After:** `./deploy.sh dev --webapp` → `DEPLOY_WEBAPP="--webapp"` ✅

### 5. CloudFront Cache Invalidation

**File:** `scripts/deploy-webapp.sh`

**What it does:**
```bash
# Create invalidation
INVALIDATION_ID=$(aws cloudfront create-invalidation \
    --distribution-id "$DIST_ID" \
    --paths "/*")

echo "✓ Cache invalidation created: $INVALIDATION_ID"
echo "💡 Note: It may take 5-15 minutes for changes to appear globally"
echo "💡 To force immediate refresh: Open DevTools → Disable cache"
```

### 6. PR Preview Environment Support

**File:** `scripts/deploy-with-cleanup.sh`

**What it does:**
```bash
# Accept PR preview environments (pr-123)
if [[ ! "$STAGE" =~ ^(dev|test|prod|pr-[0-9]+)$ ]]; then
    echo "❌ Invalid stage: $STAGE"
    exit 1
fi
```

**Supports:**
- `dev`, `test`, `prod` - Permanent environments
- `pr-123`, `pr-4` - PR preview environments

---

## How It Works Now

### Scenario 1: Fresh Deployment

```bash
npm run deploy:dev:webapp
```

**Flow:**
1. ✅ Deploy infrastructure (creates new AppSync API)
2. ✅ Fetch new API URL from CloudFormation
3. ✅ Generate `.env` with new API URL
4. ✅ Clean previous build
5. ✅ Build web app with new URL
6. ✅ Deploy to S3
7. ✅ Invalidate CloudFront cache
8. ✅ Web app works with correct API

### Scenario 2: Destroy & Redeploy

```bash
npm run destroy:dev
npm run deploy:dev:webapp
```

**Flow:**
1. ✅ Destroy all stacks (deletes old API)
2. ✅ Deploy new infrastructure (creates new API with new URL)
3. ✅ Auto-rebuild web app with new URL
4. ✅ Deploy fresh build
5. ✅ Invalidate cache
6. ✅ Web app works immediately (after cache clears)

### Scenario 3: PR Preview

```bash
# Automatically triggered when PR is created
```

**Flow:**
1. ✅ PR opened → triggers pr-preview.yml
2. ✅ Deploys `pr-4-aws-boilerplate-*` stacks
3. ✅ Fetches API URL for `pr-4` environment
4. ✅ Builds web app with `pr-4` API URL
5. ✅ Deploys to CloudFront
6. ✅ Bot comments on PR with URLs
7. ✅ When PR closes → destroys everything

---

## Verification Steps

After deployment, verify the fix:

### 1. Check Environment Variables

```bash
# Check what URL is in the .env file
cat packages/web-app/.env | grep VITE_GRAPHQL_API_URL

# Should match CloudFormation output
aws cloudformation describe-stacks \
    --stack-name dev-aws-boilerplate-appsync \
    --query "Stacks[0].Outputs[?OutputKey=='GraphQLApiUrl'].OutputValue" \
    --output text
```

### 2. Check Built Files

```bash
# The built JavaScript should contain the correct API URL
grep -r "appsync-api" packages/web-app/dist/assets/*.js | head -1
```

### 3. Check CloudFront

```bash
# Wait 5-10 minutes after deployment, then:
curl https://your-cloudfront-url.cloudfront.net | grep -o 'appsync-api[^"]*'
```

### 4. Check Browser

1. Open web app URL
2. Open DevTools → Network tab
3. Check "Disable cache"
4. Refresh page
5. Should see GraphQL requests to correct API URL

---

## Troubleshooting

### Issue: Web app still shows old API URL

**Cause:** CloudFront cache hasn't cleared yet

**Solutions:**
```bash
# Option 1: Wait 5-15 minutes for cache invalidation

# Option 2: Force immediate refresh in browser
# Open DevTools → Network tab → Check "Disable cache" → Refresh

# Option 3: Manually invalidate cache
DIST_ID=$(aws cloudformation describe-stacks \
    --stack-name dev-aws-boilerplate-web-app \
    --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" \
    --output text)
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*"

# Option 4: Redeploy web app only
./scripts/deploy-webapp.sh dev
```

### Issue: "Error fetching items" after deployment

**Cause 1:** CloudFront cache not cleared
- **Solution:** Wait or force cache clear (see above)

**Cause 2:** Web app not rebuilt
- **Solution:** Ensure `--webapp` flag was used:
  ```bash
  npm run deploy:dev:webapp  # Includes --webapp
  ```

**Cause 3:** Wrong environment
- **Solution:** Check .env file has correct stage:
  ```bash
  cat packages/web-app/.env
  ```

### Issue: Configure script fails

**Error:** `Could not retrieve API URL from CloudFormation`

**Cause:** AppSync stack doesn't exist or failed

**Solution:**
```bash
# Check if AppSync stack exists
aws cloudformation describe-stacks --stack-name dev-aws-boilerplate-appsync

# If not, deploy infrastructure first
npm run deploy:dev:webapp
```

---

## Prevention Checklist

To avoid API URL issues in the future:

✅ **Always deploy with --webapp flag when infrastructure changes**
```bash
npm run deploy:dev:webapp  # Not just npm run deploy:dev
```

✅ **Wait for cache invalidation after deployment**
- Allow 5-15 minutes for CloudFront to clear cache globally
- Or use DevTools → Disable cache for immediate testing

✅ **Don't commit .env files**
- `.env`, `.env.dev`, `.env.test`, `.env.prod` are in `.gitignore`
- These are auto-generated from CloudFormation outputs

✅ **Use PR previews for testing**
- Each PR gets isolated environment with correct URLs
- No manual configuration needed

✅ **Verify after deployment**
```bash
# Quick verification
./scripts/validate-deployment.sh dev
```

---

## Files Modified

### Scripts
- `scripts/deploy-with-cleanup.sh` - Auto-rebuild web app, argument parsing
- `scripts/deploy-webapp.sh` - Clean build, validation, better cache invalidation
- `scripts/configure-webapp.sh` - Validation, error handling

### Configuration
- `.gitignore` - Ignore `.env.*` files, allow `vite-env.d.ts`
- `packages/web-app/src/vite-env.d.ts` - TypeScript types for env vars
- `packages/infrastructure/bin/app.ts` - Support PR environments

### Pipelines
- `.github/workflows/pr-preview.yml` - Automatic PR environments
- `.github/workflows/deploy.yml` - Main deployment pipeline
- `.github/workflows/ci.yml` - Quality checks

---

## Summary

The permanent fix ensures:

1. ✅ **Web app always has correct API URL** - Auto-configured from CloudFormation
2. ✅ **Fresh build every time** - Previous build cleaned before new build
3. ✅ **Validation** - Script fails if API URL can't be retrieved
4. ✅ **Cache invalidation** - CloudFront cache cleared after deployment
5. ✅ **Works for all environments** - dev, test, prod, and PR previews

**Result:** "Error fetching items" will never happen again after following the deployment process correctly.
