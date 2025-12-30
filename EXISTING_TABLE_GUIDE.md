# Managing Existing DynamoDB Tables

## Problem

When deploying to an environment where a DynamoDB table already exists with data, you encounter this error:

```
⚠️  WARNING: Table contains data! Skipping deletion.
⚠️  Please backup and manually delete if needed.
```

Then the deployment fails because CloudFormation tries to CREATE a table that already exists:

```
Resource of type 'AWS::DynamoDB::Table' with identifier '{table-name}' already exists
```

This happens because:
1. The table exists in AWS but isn't managed by CloudFormation ("orphaned")
2. The cleanup script won't delete tables with data (safety measure)
3. CloudFormation can't create a table that already exists

---

## Solution Options

You have **3 options** to resolve this, ranked from safest to fastest:

### Option 1: Import Existing Table (Recommended ✅)

**Pros:**
- ✅ No data loss
- ✅ Zero downtime
- ✅ Table becomes CloudFormation-managed

**Cons:**
- ⚠️ Requires manual CDK import step
- ⚠️ Table schema must match CDK definition

**Steps:**

```bash
# 1. Run the import helper
./scripts/import-existing-table.sh pr-5

# 2. Follow the prompts to import via CDK
# The script will guide you through the process

# 3. Verify import succeeded
aws cloudformation describe-stack-resources \
  --stack-name pr-5-aws-boilerplate-database \
  --logical-resource-id MainTable
```

**How it works:**
The import process tells CloudFormation: "This existing table is now yours to manage" without recreating it.

---

### Option 2: Backup, Delete, Restore (Safe 🛡️)

**Pros:**
- ✅ Clean CloudFormation state
- ✅ Data preserved
- ✅ Works even if schema doesn't match

**Cons:**
- ⚠️ Requires brief downtime
- ⚠️ More steps involved

**Steps:**

```bash
# 1. Backup the table
./scripts/backup-table.sh pr-5

# Output:
# ✓ AWS backup created
#   Backup ARN: arn:aws:dynamodb:us-east-1:ACCOUNT:backup/...
# ✓ Data exported
#   File: backups/pr-5-main-table-20250125-120000.json

# 2. Delete the table
aws dynamodb delete-table --table-name pr-5-main-table

# 3. Wait for deletion
aws dynamodb wait table-not-exists --table-name pr-5-main-table

# 4. Deploy (creates fresh table)
./scripts/deploy-with-cleanup.sh pr-5 --webapp

# 5. Restore data
./scripts/restore-table.sh pr-5 backups/pr-5-main-table-20250125-120000.json

# Output:
# ✅ Restore completed successfully!
#   Items restored: 1
```

---

### Option 3: Manual Deletion (Fast ⚡ but Data Loss!)

**Pros:**
- ✅ Fastest option
- ✅ Clean slate

**Cons:**
- ❌ **PERMANENT DATA LOSS**
- ❌ Cannot be undone
- ❌ Only use for test/dev environments

**Steps:**

```bash
# ⚠️ WARNING: This deletes all data permanently!

# Delete the table
aws dynamodb delete-table --table-name pr-5-main-table

# Deploy (creates fresh table)
./scripts/deploy-with-cleanup.sh pr-5 --webapp
```

**Only use this option if:**
- The data is test data
- You have a backup elsewhere
- It's a PR preview environment you don't care about

---

## Detailed: Option 1 - Import Table

### Prerequisites

1. Table must match the CDK definition exactly:
   - Same partition key (`pk`)
   - Same sort key (`sk`)
   - Same billing mode (or compatible)
   - Same encryption settings

2. Table must not have deletion protection (will be enabled after import)

### Step-by-Step

#### 1. Check Table Configuration

```bash
# Get current table details
aws dynamodb describe-table --table-name pr-5-main-table \
  --query 'Table.{Keys:KeySchema,Billing:BillingModeSummary,Encryption:SSEDescription}'
```

Expected output:
```json
{
  "Keys": [
    {"AttributeName": "pk", "KeyType": "HASH"},
    {"AttributeName": "sk", "KeyType": "RANGE"}
  ],
  "Billing": {"BillingMode": "PAY_PER_REQUEST"},
  "Encryption": {"Status": "ENABLED"}
}
```

#### 2. Run Import Script

```bash
./scripts/import-existing-table.sh pr-5
```

The script will:
- ✅ Check if table exists
- ✅ Check if already managed by CloudFormation
- ✅ Display table configuration
- ✅ Offer to run CDK import

#### 3. CDK Import Process

If you choose "Yes" in the script:

```bash
cd packages/infrastructure
STAGE=pr-5 npx cdk import
```

CDK will prompt:
```
The following resource(s) will be imported:
  MainTable (AWS::DynamoDB::Table)

Do you want to proceed? (y/n)
```

Type `y` and press Enter.

#### 4. Verify Import

```bash
# Check CloudFormation knows about the table
aws cloudformation describe-stack-resources \
  --stack-name pr-5-aws-boilerplate-database \
  --logical-resource-id MainTable

# Should show:
# ResourceStatus: IMPORT_COMPLETE
```

#### 5. Future Deployments

Now the table is managed by CloudFormation. Future deployments will UPDATE instead of CREATE.

---

## Detailed: Option 2 - Backup & Restore

### Backup Script

```bash
./scripts/backup-table.sh <stage>
```

**Creates two backups:**
1. **AWS On-Demand Backup** (stored in DynamoDB)
   - Persists for 35 days
   - Can restore to new table
   - No additional cost

2. **Local JSON Export** (stored in `backups/` folder)
   - Complete data dump
   - Can inspect/modify before restore
   - Portable across regions/accounts

**Output:**
```
✓ AWS backup created
  Backup ARN: arn:aws:dynamodb:us-east-1:123456789:backup/...

✓ Data exported
  File: backups/pr-5-main-table-20250125-120000.json
  Items: 1
  Size: 256B
```

### Restore Script

```bash
./scripts/restore-table.sh <stage> [backup-file]
```

**Without backup file** - Lists available backups:
```bash
./scripts/restore-table.sh pr-5
```

**With backup file** - Restores specific backup:
```bash
./scripts/restore-table.sh pr-5 backups/pr-5-main-table-20250125-120000.json
```

**Features:**
- ✅ Batch writes (25 items at a time)
- ✅ Progress indicator
- ✅ Safety check (warns if table has data)
- ✅ Verification at end

---

## When Does This Happen?

This situation occurs when:

1. **Manual table creation**
   ```bash
   # Someone manually created the table
   aws dynamodb create-table --table-name pr-5-main-table ...
   ```

2. **Partial stack deletion**
   ```bash
   # Stack was deleted but table had RETAIN policy
   cdk destroy
   ```

3. **Previous deployment failed**
   - Table was created
   - Stack creation failed
   - Stack was rolled back
   - Table remained (orphaned)

4. **Drift remediation deleted stack**
   - Drift detection removed the stack
   - Table with data was preserved
   - New deployment tries to create it

---

## Prevention

### For Development/Test Environments

Use **DESTROY** removal policy so tables are always deleted with stacks:

```typescript
// Already configured in database-stack.ts
const removalPolicy = isProdLike
  ? cdk.RemovalPolicy.RETAIN    // Production: Keep data
  : cdk.RemovalPolicy.DESTROY;  // Dev/Test: Delete data
```

### For PR Preview Environments

**Option A: Always destroy** (current approach)
```bash
# PR environments are treated as dev
# Tables are destroyed when stack is deleted
STAGE=pr-5 cdk destroy --all
```

**Option B: Separate table names per PR**
```typescript
// Already done - each PR gets unique table
tableName: `${stage}-main-table`
// pr-5-main-table, pr-6-main-table, etc.
```

### For Production Environments

**Always use RETAIN** to prevent accidental data loss:
```typescript
// Already configured
removalPolicy: cdk.RemovalPolicy.RETAIN
deletionProtection: true
pointInTimeRecovery: true
```

---

## Troubleshooting

### Issue: "Table schema doesn't match CDK definition"

**Problem:** Import fails because table configuration differs from code

**Solution:**
```bash
# Check current table
aws dynamodb describe-table --table-name pr-5-main-table

# Update CDK code to match, or
# Use Option 2 (backup/restore) instead
```

### Issue: "Cannot import - stack doesn't exist"

**Problem:** CloudFormation stack was deleted

**Solution:**
```bash
# Create new stack with import
cd packages/infrastructure
STAGE=pr-5 npx cdk deploy --all

# Then use import script
./scripts/import-existing-table.sh pr-5
```

### Issue: "Backup file is huge"

**Problem:** Large tables create large backup files

**Solution:**
```bash
# Use AWS backup instead of JSON export
aws dynamodb create-backup \
  --table-name pr-5-main-table \
  --backup-name manual-backup-$(date +%Y%m%d)

# Restore from AWS backup
aws dynamodb restore-table-from-backup \
  --target-table-name pr-5-main-table-new \
  --backup-arn <backup-arn>
```

### Issue: "Restore is very slow"

**Problem:** Batch writes are throttled

**Solution:**
The restore script uses batch writes (25 items). For very large tables:

```bash
# Temporarily increase write capacity
aws dynamodb update-table \
  --table-name pr-5-main-table \
  --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=100

# Run restore
./scripts/restore-table.sh pr-5 backups/...

# Reduce capacity back
aws dynamodb update-table \
  --table-name pr-5-main-table \
  --billing-mode PAY_PER_REQUEST
```

---

## Quick Reference

### Commands Cheat Sheet

```bash
# Check if table exists and its status
aws dynamodb describe-table --table-name <table-name>

# List CloudFormation stacks
aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE

# Import existing table
./scripts/import-existing-table.sh <stage>

# Backup table
./scripts/backup-table.sh <stage>

# List available backups
./scripts/restore-table.sh <stage>

# Restore from backup
./scripts/restore-table.sh <stage> <backup-file>

# Delete table (⚠️ data loss!)
aws dynamodb delete-table --table-name <table-name>

# Deploy with cleanup
./scripts/deploy-with-cleanup.sh <stage> --webapp
```

### Decision Tree

```
Do you have an orphaned table with data?
│
├─ Is the data important?
│  ├─ YES → Option 1 (Import) or Option 2 (Backup/Restore)
│  └─ NO  → Option 3 (Delete)
│
├─ Does table schema match your CDK code?
│  ├─ YES → Option 1 (Import) - Fastest, no downtime
│  └─ NO  → Option 2 (Backup/Restore) - Update schema
│
└─ Is this a production environment?
   ├─ YES → Option 1 (Import) - Zero risk
   └─ NO  → Option 2 or 3 - Your choice
```

---

## Summary

**Best Practices:**

1. ✅ **Use Option 1 (Import)** for production or whenever possible
2. ✅ **Always backup** before any destructive operation
3. ✅ **Use DESTROY policy** for dev/test to avoid orphaned tables
4. ✅ **Use RETAIN policy** for production to protect data
5. ✅ **Test in dev first** before applying to production

**Created Tools:**

- `./scripts/import-existing-table.sh` - Import tables into CloudFormation
- `./scripts/backup-table.sh` - Backup table data (AWS + JSON)
- `./scripts/restore-table.sh` - Restore from backups
- Updated cleanup script with better guidance

All scripts are safe, interactive, and guide you through the process!
