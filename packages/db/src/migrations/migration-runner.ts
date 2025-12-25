/**
 * DynamoDB Migration Runner
 *
 * Utility for running data migrations safely with progress tracking,
 * dry-run mode, and rollback capabilities.
 */

import { DynamoDBClient, ScanCommand, UpdateItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

export interface MigrationContext {
  client: DynamoDBClient;
  tableName: string;
  stage: string;
  dryRun: boolean;
}

export interface MigrationResult {
  totalScanned: number;
  totalUpdated: number;
  totalSkipped: number;
  errors: Array<{ pk: string; sk: string; error: string }>;
}

export interface Migration {
  name: string;
  description: string;

  /**
   * Check if item needs migration
   */
  shouldMigrate: (item: any) => boolean;

  /**
   * Transform item to new format
   */
  transform: (item: any) => any;

  /**
   * Optional: Validate transformed item
   */
  validate?: (item: any) => boolean;

  /**
   * Optional: Rollback transformation
   */
  rollback?: (item: any) => any;
}

export class MigrationRunner {
  private context: MigrationContext;

  constructor(context: MigrationContext) {
    this.context = context;
  }

  /**
   * Run a migration across all items in the table
   */
  async run(migration: Migration): Promise<MigrationResult> {
    console.log(`\n🔄 Running migration: ${migration.name}`);
    console.log(`📝 Description: ${migration.description}`);
    console.log(`🏷️  Stage: ${this.context.stage}`);
    console.log(`📊 Table: ${this.context.tableName}`);
    console.log(`🔍 Dry Run: ${this.context.dryRun ? 'YES' : 'NO'}\n`);

    const result: MigrationResult = {
      totalScanned: 0,
      totalUpdated: 0,
      totalSkipped: 0,
      errors: [],
    };

    let lastEvaluatedKey: any = undefined;
    let batchCount = 0;

    do {
      // Scan table in batches
      const scanCommand = new ScanCommand({
        TableName: this.context.tableName,
        ExclusiveStartKey: lastEvaluatedKey,
        Limit: 100, // Process 100 items at a time
      });

      const scanResult = await this.context.client.send(scanCommand);
      const items = scanResult.Items?.map(item => unmarshall(item)) || [];

      result.totalScanned += items.length;
      batchCount++;

      console.log(`\n📦 Batch ${batchCount}: Processing ${items.length} items...`);

      // Process each item
      for (const item of items) {
        try {
          // Check if item needs migration
          if (!migration.shouldMigrate(item)) {
            result.totalSkipped++;
            continue;
          }

          // Transform item
          const transformed = migration.transform(item);

          // Validate if validator provided
          if (migration.validate && !migration.validate(transformed)) {
            result.errors.push({
              pk: item.pk,
              sk: item.sk,
              error: 'Validation failed',
            });
            continue;
          }

          // Update item (unless dry run)
          if (!this.context.dryRun) {
            await this.updateItem(transformed);
          }

          result.totalUpdated++;

          // Log progress every 10 items
          if (result.totalUpdated % 10 === 0) {
            console.log(`  ✓ Updated ${result.totalUpdated} items...`);
          }
        } catch (error) {
          result.errors.push({
            pk: item.pk,
            sk: item.sk,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      lastEvaluatedKey = scanResult.LastEvaluatedKey;

      // Show batch progress
      console.log(`  Batch ${batchCount} complete: ${result.totalUpdated} updated, ${result.totalSkipped} skipped`);

    } while (lastEvaluatedKey);

    // Print summary
    this.printSummary(migration, result);

    return result;
  }

  /**
   * Update a single item in DynamoDB
   */
  private async updateItem(item: any): Promise<void> {
    const updateCommand = new UpdateItemCommand({
      TableName: this.context.tableName,
      Key: marshall({
        pk: item.pk,
        sk: item.sk,
      }),
      UpdateExpression: this.buildUpdateExpression(item),
      ExpressionAttributeNames: this.buildAttributeNames(item),
      ExpressionAttributeValues: marshall(this.buildAttributeValues(item)),
    });

    await this.context.client.send(updateCommand);
  }

  /**
   * Build DynamoDB UpdateExpression
   */
  private buildUpdateExpression(item: any): string {
    const fields = Object.keys(item).filter(key => key !== 'pk' && key !== 'sk');
    const setExpressions = fields.map((_, index) => `#field${index} = :value${index}`);
    return `SET ${setExpressions.join(', ')}, updatedAt = :updatedAt`;
  }

  /**
   * Build ExpressionAttributeNames
   */
  private buildAttributeNames(item: any): Record<string, string> {
    const fields = Object.keys(item).filter(key => key !== 'pk' && key !== 'sk');
    const names: Record<string, string> = {};
    fields.forEach((field, index) => {
      names[`#field${index}`] = field;
    });
    return names;
  }

  /**
   * Build ExpressionAttributeValues
   */
  private buildAttributeValues(item: any): Record<string, any> {
    const fields = Object.keys(item).filter(key => key !== 'pk' && key !== 'sk');
    const values: Record<string, any> = {};
    fields.forEach((field, index) => {
      values[`:value${index}`] = item[field];
    });
    values[':updatedAt'] = new Date().toISOString();
    return values;
  }

  /**
   * Print migration summary
   */
  private printSummary(migration: Migration, result: MigrationResult): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 Migration Summary');
    console.log('='.repeat(60));
    console.log(`Migration:     ${migration.name}`);
    console.log(`Total Scanned: ${result.totalScanned}`);
    console.log(`Total Updated: ${result.totalUpdated}`);
    console.log(`Total Skipped: ${result.totalSkipped}`);
    console.log(`Errors:        ${result.errors.length}`);

    if (result.errors.length > 0) {
      console.log('\n❌ Errors:');
      result.errors.forEach(err => {
        console.log(`  - ${err.pk}#${err.sk}: ${err.error}`);
      });
    }

    if (this.context.dryRun) {
      console.log('\n⚠️  DRY RUN MODE - No changes were made');
    } else {
      console.log('\n✅ Migration completed successfully!');
    }
    console.log('='.repeat(60) + '\n');
  }

  /**
   * Rollback a migration
   */
  async rollback(migration: Migration): Promise<MigrationResult> {
    if (!migration.rollback) {
      throw new Error('Migration does not support rollback');
    }

    console.log(`\n⏪ Rolling back migration: ${migration.name}\n`);

    const rollbackMigration: Migration = {
      name: `${migration.name}-rollback`,
      description: `Rollback: ${migration.description}`,
      shouldMigrate: (item) => !migration.shouldMigrate(item), // Reverse logic
      transform: migration.rollback,
      validate: migration.validate,
    };

    return this.run(rollbackMigration);
  }
}

/**
 * CLI helper to run migrations
 */
export async function runMigrationCLI(migration: Migration): Promise<void> {
  const stage = process.env.STAGE || 'dev';
  const region = process.env.AWS_REGION || 'us-east-1';
  const dryRun = process.argv.includes('--dry-run');
  const isRollback = process.argv.includes('--rollback');

  const tableName = `${stage}-main-table`;

  const client = new DynamoDBClient({ region });

  const context: MigrationContext = {
    client,
    tableName,
    stage,
    dryRun,
  };

  const runner = new MigrationRunner(context);

  try {
    let result: MigrationResult;

    if (isRollback) {
      result = await runner.rollback(migration);
    } else {
      result = await runner.run(migration);
    }

    // Exit with error if there were errors
    if (result.errors.length > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}
