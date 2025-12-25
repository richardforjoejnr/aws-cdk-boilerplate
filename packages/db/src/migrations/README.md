# Database Migration Strategy

## DynamoDB Migration Approach

Since DynamoDB is schemaless, we handle schema changes at the application level using the **Expand-Contract** pattern.

## Migration Pattern

### 1. Expand (Add New Fields)
- Deploy code that writes both old and new fields
- Existing data continues to work
- New deployments write new format

### 2. Backfill (Optional)
- Run migration script to update existing records
- Can be done gradually in background
- No downtime required

### 3. Contract (Remove Old Fields)
- After all data is migrated, stop writing old fields
- Eventually remove old field reads from code
- Clean up unused attributes

## Example Migration

### Scenario: Add structured address field

**Before:**
```typescript
{
  pk: 'ITEM#123',
  sk: 'METADATA',
  name: 'My Item',
  description: 'Simple description'
}
```

**After:**
```typescript
{
  pk: 'ITEM#123',
  sk: 'METADATA',
  name: 'My Item',
  description: 'Simple description',
  metadata: {
    tags: ['important', 'archived'],
    category: 'electronics'
  }
}
```

## Migration Scripts

Place migration scripts in this directory following the naming convention:
```
YYYYMMDD-description.ts
```

Example:
```
20250125-add-metadata-field.ts
20250201-backfill-item-categories.ts
```

## Running Migrations

```bash
# Dry run (preview changes)
npm run migration:run -- --dry-run

# Apply to dev
STAGE=dev npm run migration:run

# Apply to prod (with confirmation)
STAGE=prod npm run migration:run
```

## Best Practices

1. **Always use Expand-Contract** - Never break existing data
2. **Test in dev first** - Always test migrations in dev environment
3. **Make reversible** - Ensure you can rollback if needed
4. **Monitor progress** - Track migration completion percentage
5. **Keep old code temporarily** - Don't delete old field handling immediately
6. **Version your schema** - Use version field to track data format

## Handling Production Data

### DynamoDB Point-in-Time Recovery (PITR)

Your production tables should have PITR enabled:

```typescript
// In database-stack.ts
table.enablePointInTimeRecovery = true;
```

### Backup Before Major Migrations

```bash
# Create on-demand backup
aws dynamodb create-backup \
  --table-name prod-main-table \
  --backup-name before-migration-$(date +%Y%m%d)
```

### Table Export for Large Changes

```bash
# Export entire table to S3
aws dynamodb export-table-to-point-in-time \
  --table-arn arn:aws:dynamodb:us-east-1:ACCOUNT:table/prod-main-table \
  --s3-bucket my-backup-bucket \
  --s3-prefix backups/$(date +%Y%m%d)/
```

## Rollback Strategy

If a migration fails:

1. **Code Rollback**: Deploy previous version
2. **Data Rollback**:
   - Use PITR to restore to before migration
   - Or run reverse migration script

## Schema Versioning

Add version field to track data format:

```typescript
interface Item {
  pk: string;
  sk: string;
  version: number;  // Track schema version
  name: string;
  // ... other fields
}

// Handle multiple versions
function normalizeItem(item: any): Item {
  if (!item.version || item.version === 1) {
    return upgradeV1toV2(item);
  }
  return item;
}
```
