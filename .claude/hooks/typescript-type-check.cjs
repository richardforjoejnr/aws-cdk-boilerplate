#!/usr/bin/env node

/**
 * TypeScript Type Checking Hook (PostToolUse)
 *
 * This hook runs after Claude edits any TypeScript file and checks for type errors.
 * When Claude modifies a function signature, it often doesn't update all call sites.
 * This hook catches those errors immediately and feeds them back to Claude.
 *
 * How it works:
 * 1. Triggers after Edit tool is used on .ts files
 * 2. Runs `tsc --noEmit` to check for type errors
 * 3. Captures any errors found
 * 4. Returns errors to Claude for immediate fixing
 *
 * Exit codes:
 * - 0: No type errors, or hook completed successfully
 * - 1: Hook execution error
 */

const { exec } = require('child_process');
const path = require('path');

async function main() {
  const chunks = [];

  // Read JSON input from stdin
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  const toolArgs = JSON.parse(Buffer.concat(chunks).toString());

  // Only run type checking after Edit operations on TypeScript files
  if (toolArgs.tool_name !== 'Edit') {
    process.exit(0);
  }

  const filePath = toolArgs.tool_input?.file_path || '';

  // Only check TypeScript files
  if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) {
    process.exit(0);
  }

  // Get project directory (parent of .claude directory)
  const projectDir = path.resolve(__dirname, '../..');

  console.error(`\n🔍 Running TypeScript type check after editing: ${path.basename(filePath)}`);

  // Run TypeScript compiler in check mode
  exec(
    'npx tsc --noEmit',
    { cwd: projectDir, maxBuffer: 1024 * 1024 * 10 }, // 10MB buffer
    (error, stdout, stderr) => {
      if (error) {
        // tsc exits with code 1 when there are type errors
        const output = stdout + stderr;

        if (output.trim()) {
          console.error('\n❌ TypeScript type errors detected:\n');
          console.error(output);
          console.error('\n💡 Please fix these type errors in the affected files.');
        } else {
          console.error('\n⚠️ TypeScript compiler failed but produced no output.');
        }

        // Don't block Claude - let it continue but with error feedback
        process.exit(0);
      }

      console.error('✅ No TypeScript type errors detected.');
      process.exit(0);
    }
  );
}

main().catch((error) => {
  console.error(`Hook error: ${error.message}`);
  process.exit(1);
});
