# Database Management Guide

## Overview

This guide explains how to safely manage database schema changes and data migrations in production environments.

---

## Current Protection Mechanisms

### Production Safeguards (Already Implemented)

Your database stack (`packages/infrastructure/lib/database-stack.ts`) includes:

✅ **Point-in-Time Recovery (PITR)**
- Enabled for production/test environments
- Allows recovery to any point in the last 35 days
- Continuous backups with no performance impact

✅ **Deletion Protection**
- Prevents accidental table deletion in production
- Must be manually disabled before deletion

✅ **Retention Policy**
- Production: `RETAIN` - Table persists after stack deletion
- Dev/Test: `DESTROY` - Table deleted with stack for easy cleanup

✅ **Encryption**
- AWS-managed encryption at rest
- Protects sensitive data

✅ **DynamoDB Streams**
- Captures all changes (NEW_AND_OLD_IMAGES)
- Enables CDC (Change Data Capture) patterns
- Can trigger Lambda for real-time processing

---

## Schema Change Strategies

### DynamoDB vs SQL Databases

| Aspect | SQL (PostgreSQL, MySQL) | DynamoDB |
|--------|------------------------|----------|
| Schema | Explicit (ALTER TABLE) | Schemaless (app-level) |
| Migrations | Required for schema | Required for data only |
| Downtime | Often required | Zero downtime possible |
| Rollback | Complex | Easier with versioning |
| Tools | Flyway, Liquibase | Custom scripts |

### Our Approach: Expand-Contract Pattern

```
Phase 1: EXPAND
├─ Deploy code that writes BOTH old and new fields
├─ New data uses new format
└─ Old data still works

Phase 2: BACKFILL (Optional)
├─ Run migration script to update existing records
├─ Can be done gradually
└─ Monitor progress

Phase 3: CONTRACT
├─ Deploy code that only writes new field
├─ Remove old field handling
└─ Clean up unused attributes
```

---

## Migration Workflow

### 1. Development Phase

```bash
# Create migration script
touch packages/db/src/migrations/$(date +%Y%m%d)-my-migration.ts

# Write migration logic
# See example: packages/db/src/migrations/example-add-metadata.ts
```

### 2. Testing Phase

```bash
# Test in dev environment with dry-run
STAGE=dev npm run migration:run -- --dry-run

# Apply to dev
STAGE=dev npm run migration:run

# Verify changes
aws dynamodb scan --table-name dev-main-table --limit 10
```

### 3. Staging/Test Phase

```bash
# Create backup before migration
aws dynamodb create-backup \
  --table-name test-main-table \
  --backup-name before-migration-$(date +%Y%m%d)

# Apply to test
STAGE=test npm run migration:run

# Verify
STAGE=test npm run migration:verify
```

### 4. Production Phase

```bash
# 1. Create on-demand backup
aws dynamodb create-backup \
  --table-name prod-main-table \
  --backup-name before-migration-$(date +%Y%m%d-%H%M)

# 2. Export table to S3 (for large tables)
aws dynamodb export-table-to-point-in-time \
  --table-arn arn:aws:dynamodb:us-east-1:ACCOUNT:table/prod-main-table \
  --s3-bucket my-backups \
  --s3-prefix exports/$(date +%Y%m%d)/

# 3. Run migration with dry-run first
STAGE=prod npm run migration:run -- --dry-run

# 4. Review dry-run output carefully

# 5. Apply migration
STAGE=prod npm run migration:run

# 6. Monitor CloudWatch metrics
# 7. Verify sample records
# 8. Keep old code deployed for 24-48 hours
```

---

## Common Migration Patterns

### Pattern 1: Add New Field

**Before:**
```typescript
interface Item {
  pk: string;
  sk: string;
  name: string;
}
```

**After:**
```typescript
interface Item {
  pk: string;
  sk: string;
  name: string;
  category?: string;  // New optional field
}
```

**Migration:**
```typescript
// Not needed! Just add to new records
// Old records work fine without it
```

### Pattern 2: Rename Field

**Before:**
```typescript
{ pk, sk, address: '123 Main St' }
```

**After:**
```typescript
{ pk, sk, location: '123 Main St' }
```

**Migration Steps:**
```typescript
// Step 1: EXPAND - Write both fields
function saveItem(item) {
  return {
    ...item,
    address: item.location,  // Keep old field
    location: item.location, // Add new field
  };
}

// Step 2: BACKFILL - Run migration
migration: {
  transform: (item) => ({
    ...item,
    location: item.address,
  })
}

// Step 3: CONTRACT - Remove old field
function saveItem(item) {
  return {
    ...item,
    location: item.location, // Only new field
  };
}
```

### Pattern 3: Restructure Data

**Before:**
```typescript
{
  pk: 'ITEM#123',
  sk: 'METADATA',
  address: '123 Main St, Boston, MA'
}
```

**After:**
```typescript
{
  pk: 'ITEM#123',
  sk: 'METADATA',
  addressDetails: {
    street: '123 Main St',
    city: 'Boston',
    state: 'MA'
  }
}
```

**Migration:**
```typescript
migration: {
  shouldMigrate: (item) => !item.addressDetails && item.address,
  transform: (item) => ({
    ...item,
    addressDetails: parseAddress(item.address),
  })
}
```

### Pattern 4: Schema Versioning

```typescript
// Add version field to track format
interface ItemV1 {
  version: 1;
  pk: string;
  sk: string;
  oldFormat: string;
}

interface ItemV2 {
  version: 2;
  pk: string;
  sk: string;
  newFormat: {
    field1: string;
    field2: string;
  };
}

// Handle both versions in application
function processItem(item: any) {
  if (item.version === 1) {
    return upgradeV1ToV2(item);
  }
  return item as ItemV2;
}
```

---

## Backup and Recovery

### Point-in-Time Recovery (PITR)

**Enabled by default for prod/test**

```bash
# Restore table to specific time
aws dynamodb restore-table-to-point-in-time \
  --source-table-name prod-main-table \
  --target-table-name prod-main-table-restored \
  --restore-date-time "2025-01-25T10:00:00Z"
```

### On-Demand Backups

```bash
# Create backup
aws dynamodb create-backup \
  --table-name prod-main-table \
  --backup-name prod-backup-$(date +%Y%m%d)

# List backups
aws dynamodb list-backups --table-name prod-main-table

# Restore from backup
aws dynamodb restore-table-from-backup \
  --target-table-name prod-main-table-restored \
  --backup-arn arn:aws:dynamodb:us-east-1:ACCOUNT:table/prod-main-table/backup/01234567890
```

### Export to S3 (For Large Tables)

```bash
# Export entire table
aws dynamodb export-table-to-point-in-time \
  --table-arn arn:aws:dynamodb:us-east-1:ACCOUNT:table/prod-main-table \
  --s3-bucket my-backup-bucket \
  --s3-prefix exports/$(date +%Y%m%d)/ \
  --export-format DYNAMODB_JSON

# Import from S3 (if needed)
aws dynamodb import-table \
  --s3-bucket-source S3BucketSource=my-backup-bucket,S3KeyPrefix=exports/20250125/ \
  --input-format DYNAMODB_JSON \
  --table-creation-parameters "TableName=prod-main-table-restored,..."
```

---

## Rollback Strategies

### Application-Level Rollback

```bash
# Deploy previous version of application
git checkout <previous-commit>
npm run deploy:prod

# Old code handles both old and new data formats
```

### Data-Level Rollback

```bash
# Use PITR to restore to before migration
aws dynamodb restore-table-to-point-in-time \
  --source-table-name prod-main-table \
  --target-table-name prod-main-table-backup \
  --use-latest-restorable-time

# Swap table names after verification
# (Requires stack update)
```

### Migration Rollback

```bash
# Run reverse migration
STAGE=prod npm run migration:run -- --rollback

# Verify
aws dynamodb scan --table-name prod-main-table --limit 10
```

---

## Monitoring Migrations

### CloudWatch Metrics to Watch

```bash
# Monitor during migration:
- ConsumedReadCapacityUnits
- ConsumedWriteCapacityUnits
- UserErrors
- SystemErrors
- ThrottledRequests
```

### Migration Progress Tracking

```typescript
// Built into migration runner
console.log(`Progress: ${updated}/${total} (${percentage}%)`);

// Custom metrics
await cloudwatch.putMetricData({
  Namespace: 'Migrations',
  MetricData: [{
    MetricName: 'ItemsProcessed',
    Value: count,
    Unit: 'Count',
  }],
});
```

---

## Best Practices

### ✅ DO

1. **Always test in dev first**
   ```bash
   STAGE=dev npm run migration:run --dry-run
   ```

2. **Use dry-run mode**
   - Preview changes before applying
   - Verify transformation logic
   - Check error rate

3. **Enable PITR for production**
   - Already enabled in your stack
   - Provides 35 days of recovery

4. **Create backups before major changes**
   ```bash
   aws dynamodb create-backup --table-name prod-main-table --backup-name pre-migration
   ```

5. **Monitor during migration**
   - Watch CloudWatch metrics
   - Check application logs
   - Monitor error rates

6. **Keep old code deployed temporarily**
   - Don't immediately remove old field handling
   - Wait 24-48 hours after migration
   - Ensures rollback capability

7. **Use schema versioning**
   - Add version field to items
   - Track data format evolution
   - Simplify future migrations

### ❌ DON'T

1. **Don't run migrations during peak hours**
   - Schedule during low-traffic periods
   - Consider maintenance windows

2. **Don't skip testing**
   - Always test in dev/test first
   - Verify on sample of production data

3. **Don't delete old fields immediately**
   - Keep for compatibility
   - Remove in separate deployment

4. **Don't ignore throttling**
   - Batch operations appropriately
   - Add delays if needed

5. **Don't forget rollback plan**
   - Always have a way back
   - Test rollback in dev

---

## Migration Checklist

### Pre-Migration
- [ ] Migration tested in dev environment
- [ ] Dry-run completed successfully
- [ ] Backup created
- [ ] Rollback plan documented
- [ ] Team notified of maintenance window
- [ ] Monitoring dashboards ready

### During Migration
- [ ] Migration running
- [ ] CloudWatch metrics monitored
- [ ] Error logs checked
- [ ] Progress tracked
- [ ] Sample records verified

### Post-Migration
- [ ] All items migrated successfully
- [ ] Application functioning normally
- [ ] No increase in error rates
- [ ] Performance metrics normal
- [ ] Backup retained for 7 days
- [ ] Documentation updated

---

## Useful Commands

```bash
# Create migration
npm run migration:create -- add-tags

# Run migration (dry-run)
STAGE=dev npm run migration:run -- --dry-run

# Run migration
STAGE=prod npm run migration:run

# Rollback migration
STAGE=prod npm run migration:run -- --rollback

# Check table status
aws dynamodb describe-table --table-name prod-main-table

# Create backup
aws dynamodb create-backup \
  --table-name prod-main-table \
  --backup-name backup-$(date +%Y%m%d)

# Restore from PITR
aws dynamodb restore-table-to-point-in-time \
  --source-table-name prod-main-table \
  --target-table-name prod-main-table-restored \
  --use-latest-restorable-time
```

---

## Resources

- [DynamoDB Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)
- [Point-in-Time Recovery](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/PointInTimeRecovery.html)
- [DynamoDB Backups](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/BackupRestore.html)
- [Migration Tools](packages/db/src/migrations/README.md)

---

## Support

For questions or issues:
1. Check this guide
2. Review migration examples in `packages/db/src/migrations/`
3. Test thoroughly in dev environment
4. Consult team before production migrations
