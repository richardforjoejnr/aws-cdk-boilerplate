#!/usr/bin/env node

/**
 * Initialize Claude Code settings with absolute paths
 *
 * This script:
 * 1. Reads settings.example.json
 * 2. Replaces $PWD placeholder with the absolute project path
 * 3. Creates settings.local.json with the resolved paths
 *
 * This allows us to:
 * - Share settings.example.json in version control
 * - Use absolute paths (recommended for security)
 * - Avoid path interception and binary planting attacks
 */

const fs = require('fs');
const path = require('path');

// Get the absolute project directory
const projectDir = path.resolve(__dirname, '..');

// Paths to settings files
const exampleSettingsPath = path.join(projectDir, '.claude', 'settings.example.json');
const localSettingsPath = path.join(projectDir, '.claude', 'settings.local.json');

function main() {
  console.log('🔧 Initializing Claude Code settings...\n');

  // Check if settings.example.json exists
  if (!fs.existsSync(exampleSettingsPath)) {
    console.error('❌ Error: settings.example.json not found at:', exampleSettingsPath);
    process.exit(1);
  }

  // Read the example settings
  let settingsContent;
  try {
    settingsContent = fs.readFileSync(exampleSettingsPath, 'utf8');
  } catch (error) {
    console.error('❌ Error reading settings.example.json:', error.message);
    process.exit(1);
  }

  // Replace $PWD with absolute project path
  const resolvedSettings = settingsContent.replace(/\$PWD/g, projectDir);

  // Write to settings.local.json
  try {
    fs.writeFileSync(localSettingsPath, resolvedSettings, 'utf8');
    console.log('✅ Created settings.local.json with absolute paths');
    console.log(`   Project directory: ${projectDir}\n`);
  } catch (error) {
    console.error('❌ Error writing settings.local.json:', error.message);
    process.exit(1);
  }

  // Verify the generated file is valid JSON
  try {
    JSON.parse(resolvedSettings);
    console.log('✅ settings.local.json is valid JSON');
  } catch (error) {
    console.error('❌ Error: Generated settings.local.json is not valid JSON:', error.message);
    process.exit(1);
  }

  console.log('\n🎉 Claude Code settings initialized successfully!');
  console.log('   You can now use Claude Code with secure absolute paths.\n');
}

main();
