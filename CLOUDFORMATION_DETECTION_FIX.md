# CloudFormation Detection Fix

## Problem

The cleanup script and GitHub Actions pipelines were incorrectly flagging CloudFormation-managed DynamoDB tables as "orphaned" due to relying on resource tags for detection.

### Root Cause

The original implementation used `list-tags-of-resource` to check for the `aws:cloudformation:stack-name` tag:

```bash
# OLD APPROACH (Tag-based)
local stack_name=$(aws dynamodb list-tags-of-resource \
    --resource-arn "arn:aws:dynamodb:${REGION}:ACCOUNT:table/${table_name}" \
    --region "$REGION" | \
    jq -r '.Tags[] | select(.Key=="aws:cloudformation:stack-name") | .Value')
```

**Issue:** Some CloudFormation-managed resources may not have this tag, causing false positives.

**Example:** The `pr-5-main-table` was correctly managed by CloudFormation stack `pr-5-aws-boilerplate-database` but was missing the CloudFormation tags, resulting in:
- ❌ Cleanup script flagging it as orphaned
- ❌ Deployment requiring `--skip-cleanup` workaround
- ❌ Confusing error messages

---

## Solution

Updated all detection logic to use **CloudFormation API** instead of tags:

```bash
# NEW APPROACH (API-based)
# Query by resource type and physical ID since logical ID has hash suffix
IS_MANAGED=false
if aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" >/dev/null 2>&1; then

    CF_TABLE_NAME=$(aws cloudformation describe-stack-resources \
        --stack-name "$STACK_NAME" \
        --region "$REGION" \
        --query "StackResources[?ResourceType=='AWS::DynamoDB::Table' && PhysicalResourceId=='${TABLE_NAME}'].PhysicalResourceId" \
        --output text)

    if [ "$CF_TABLE_NAME" = "$TABLE_NAME" ]; then
        IS_MANAGED=true
    fi
fi
```

### Why This Works Better

1. **Direct Source of Truth**: CloudFormation API is the authoritative source for stack resources
2. **No Tag Dependency**: Doesn't rely on tags that may be missing or incorrect
3. **Handles Hash Suffixes**: Works with logical IDs like `MainTable74195DAB`
4. **No False Positives**: Accurately identifies truly orphaned resources

---

## Files Modified

### 1. `scripts/cleanup-orphaned-resources.sh`

**Changes:**
- Replaced tag-based detection with CloudFormation API query
- Added `BLUE` color variable for error messages
- Updated success message for managed tables
- Now correctly identifies `pr-5-main-table` as managed

**Before:**
```bash
✗ Table is NOT managed by CloudFormation (orphaned)
⚠️  WARNING: Table contains data! Cannot proceed with cleanup.
```

**After:**
```bash
✓ Table is managed by CloudFormation stack: pr-5-aws-boilerplate-database
→ No cleanup needed
```

### 2. `.github/workflows/deploy.yml`

**Changes:**
- Updated `Check for orphaned table` step
- Replaced `--logical-resource-id "MainTable"` with ResourceType query
- Uses same logic as cleanup script

**Lines Changed:** 121-171

### 3. `.github/workflows/pr-preview.yml`

**Changes:**
- Updated `Check for existing table with data` step
- Replaced `--logical-resource-id "MainTable"` with ResourceType query
- Consistent with deploy.yml approach

**Lines Changed:** 58-113

### 4. `PIPELINE_TABLE_HANDLING.md`

**Changes:**
- Added "Detection Method" section explaining API-based approach
- Documents advantages over tag-based detection
- Explains hash suffix handling

---

## Testing

### Test Case: pr-5 Environment

**Before Fix:**
```bash
$ ./scripts/cleanup-orphaned-resources.sh pr-5
⚠️ Orphaned table with 2 items detected
(Shows 3 options for handling)
```

**After Fix:**
```bash
$ ./scripts/cleanup-orphaned-resources.sh pr-5
✓ Table is managed by CloudFormation stack: pr-5-aws-boilerplate-database
→ No cleanup needed
✅ Cleanup completed successfully!
```

### Verification

Confirmed table is managed by CloudFormation:
```bash
$ aws cloudformation describe-stack-resources \
    --stack-name pr-5-aws-boilerplate-database \
    --query 'StackResources[?ResourceType==`AWS::DynamoDB::Table`]'

[
    {
        "LogicalId": "MainTable74195DAB",
        "PhysicalId": "pr-5-main-table",
        "ResourceType": "AWS::DynamoDB::Table",
        "ResourceStatus": "CREATE_COMPLETE"
    }
]
```

---

## Benefits

1. ✅ **No More False Positives**: Correctly identifies CloudFormation-managed tables
2. ✅ **No Workarounds Needed**: Don't need `--skip-cleanup` flag anymore
3. ✅ **Consistent Detection**: Same logic across scripts and pipelines
4. ✅ **Reliable Automation**: GitHub Actions workflows work correctly
5. ✅ **Better UX**: Clear, accurate messages about table status

---

## Migration Notes

**For Existing Deployments:**

No action required! The fix is backward compatible:
- Already-deployed tables will now be correctly identified as managed
- No changes needed to CloudFormation stacks
- Scripts and pipelines work seamlessly

**For Future Deployments:**

Tables will continue to work correctly whether they have CloudFormation tags or not, as the detection no longer depends on them.

---

## Summary

This fix eliminates false positives in orphaned table detection by using CloudFormation API as the source of truth instead of resource tags. This ensures deployments proceed smoothly and cleanup scripts accurately identify truly orphaned resources.

**Key Takeaway:** When checking if a resource is CloudFormation-managed, always use the CloudFormation API (`describe-stack-resources`) rather than relying on tags.
