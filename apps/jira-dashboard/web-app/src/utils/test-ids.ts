/**
 * Test ID utilities for UI automation
 *
 * This file provides a centralized, type-safe way to manage test-id attributes
 * for UI automation testing (Playwright, Cypress, Selenium, etc.)
 *
 * Naming Convention:
 * - Use kebab-case for all test IDs
 * - Format: {component}-{element}-{action?}
 * - Examples:
 *   - "create-form-submit-button"
 *   - "data-table-row"
 *   - "item-name-input"
 */

/**
 * Helper function to generate consistent test IDs
 * @param parts - Parts of the test ID to join with hyphens
 * @returns A kebab-case test ID string
 */
export const testId = (...parts: string[]): string => {
  return parts.filter(Boolean).join('-').toLowerCase();
};

/**
 * Centralized test IDs for the application
 * Organized by feature/component for easy maintenance
 */
export const TEST_IDS = {
  // App Layout
  APP: {
    HEADER: 'app-header',
    TITLE: 'app-title',
    SUBTITLE: 'app-subtitle',
    MAIN: 'app-main',
    ERROR_MESSAGE: 'app-error-message',
  },

  // Create Item Form
  CREATE_FORM: {
    CONTAINER: 'create-form-container',
    TITLE: 'create-form-title',
    NAME_INPUT: 'create-form-name-input',
    NAME_LABEL: 'create-form-name-label',
    DESCRIPTION_INPUT: 'create-form-description-input',
    DESCRIPTION_LABEL: 'create-form-description-label',
    SUBMIT_BUTTON: 'create-form-submit-button',
  },

  // Items Section
  ITEMS: {
    SECTION: 'items-section',
    HEADER: 'items-section-header',
    TITLE: 'items-section-title',
    COUNT: 'items-section-count',
    REFRESH_BUTTON: 'items-refresh-button',
  },

  // Data Table
  DATA_TABLE: {
    CONTAINER: 'data-table-container',
    TABLE: 'data-table',
    LOADING: 'data-table-loading',
    EMPTY_STATE: 'data-table-empty-state',
    THEAD: 'data-table-thead',
    TBODY: 'data-table-tbody',
    HEADER_NAME: 'data-table-header-name',
    HEADER_DESCRIPTION: 'data-table-header-description',
    HEADER_CREATED_AT: 'data-table-header-created-at',
    HEADER_ACTIONS: 'data-table-header-actions',
    // Dynamic row selectors (use with item ID)
    ROW: 'data-table-row',
    CELL_NAME: 'data-table-cell-name',
    CELL_DESCRIPTION: 'data-table-cell-description',
    CELL_CREATED_AT: 'data-table-cell-created-at',
    CELL_ACTIONS: 'data-table-cell-actions',
    DELETE_BUTTON: 'data-table-delete-button',
  },
} as const;

/**
 * Helper to create dynamic test IDs for list items
 * @param baseId - Base test ID
 * @param itemId - Unique identifier for the item
 * @returns Combined test ID with item identifier
 */
export const getItemTestId = (baseId: string, itemId: string): string => {
  return `${baseId}-${itemId}`;
};

/**
 * Type-safe data-testid attribute generator
 * Usage: <div {...testDataAttr('my-component')} />
 */
export const testDataAttr = (id: string) => {
  return { 'data-testid': id };
};
