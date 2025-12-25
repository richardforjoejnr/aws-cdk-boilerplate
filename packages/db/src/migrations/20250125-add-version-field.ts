/**
 * Migration: Add version field to all items
 *
 * Date: 2025-01-25
 * Description: Adds a version field to track schema version for future migrations
 *
 * Usage:
 *   # Dry run
 *   STAGE=dev tsx src/migrations/20250125-add-version-field.ts --dry-run
 *
 *   # Apply to dev
 *   STAGE=dev tsx src/migrations/20250125-add-version-field.ts
 *
 *   # Apply to prod
 *   STAGE=prod tsx src/migrations/20250125-add-version-field.ts
 *
 *   # Rollback
 *   STAGE=dev tsx src/migrations/20250125-add-version-field.ts --rollback
 */

import { Migration, runMigrationCLI } from './migration-runner';

const migration: Migration = {
  name: '20250125-add-version-field',
  description: 'Add version field to all items for schema versioning',

  /**
   * Check if item needs migration
   * Only migrate items that don't have a version field
   */
  shouldMigrate: (item: any): boolean => {
    return !item.version;
  },

  /**
   * Transform item by adding version field
   */
  transform: (item: any): any => {
    return {
      ...item,
      version: 1,
    };
  },

  /**
   * Validate transformed item
   */
  validate: (item: any): boolean => {
    return item.version === 1;
  },

  /**
   * Rollback: Remove version field
   */
  rollback: (item: any): any => {
    const { version, ...rest } = item;
    return rest;
  },
};

// Run migration if executed directly
if (require.main === module) {
  runMigrationCLI(migration);
}

export default migration;
