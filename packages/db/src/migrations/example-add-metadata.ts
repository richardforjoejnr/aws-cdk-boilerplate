/**
 * Example Migration: Add metadata field
 *
 * This is an example of a more complex migration that:
 * - Adds a new nested object field
 * - Transforms existing data into the new format
 * - Validates the transformation
 * - Supports rollback
 *
 * Scenario: We want to add rich metadata to items including tags and categories
 */

import { Migration, runMigrationCLI } from './migration-runner';

interface OldItem {
  pk: string;
  sk: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

interface NewItem extends OldItem {
  metadata: {
    tags: string[];
    category: string;
    priority: 'low' | 'medium' | 'high';
  };
}

const migration: Migration = {
  name: 'example-add-metadata',
  description: 'Add metadata field with tags, category, and priority',

  shouldMigrate: (item: any): boolean => {
    // Migrate items that don't have metadata yet
    return !item.metadata;
  },

  transform: (item: OldItem): NewItem => {
    // Derive metadata from existing fields
    const tags: string[] = [];

    // Example: Extract tags from description
    if (item.description) {
      const hashtagRegex = /#(\w+)/g;
      const matches = item.description.matchAll(hashtagRegex);
      for (const match of matches) {
        tags.push(match[1]);
      }
    }

    // Example: Infer category from name
    const category = inferCategory(item.name);

    // Example: Default priority
    const priority = 'medium' as const;

    return {
      ...item,
      metadata: {
        tags,
        category,
        priority,
      },
    };
  },

  validate: (item: any): boolean => {
    // Validate metadata structure
    if (!item.metadata) return false;
    if (!Array.isArray(item.metadata.tags)) return false;
    if (typeof item.metadata.category !== 'string') return false;
    if (!['low', 'medium', 'high'].includes(item.metadata.priority)) return false;
    return true;
  },

  rollback: (item: NewItem): OldItem => {
    // Remove metadata field
    const { metadata, ...rest } = item;
    return rest;
  },
};

/**
 * Helper: Infer category from item name
 */
function inferCategory(name: string): string {
  const lowerName = name.toLowerCase();

  if (lowerName.includes('urgent') || lowerName.includes('critical')) {
    return 'urgent';
  }
  if (lowerName.includes('bug') || lowerName.includes('fix')) {
    return 'bug';
  }
  if (lowerName.includes('feature')) {
    return 'feature';
  }
  if (lowerName.includes('docs') || lowerName.includes('documentation')) {
    return 'documentation';
  }

  return 'general';
}

// Run migration if executed directly
if (require.main === module) {
  runMigrationCLI(migration);
}

export default migration;
