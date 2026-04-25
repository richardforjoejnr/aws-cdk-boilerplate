#!/usr/bin/env node

/**
 * Hook to block access to sensitive files
 * This hook intercepts Read and Grep tool calls and prevents access to:
 * - .env files (environment variables)
 * - credential files
 * - private keys
 * - other sensitive configuration files
 */

async function main() {
  const chunks = [];

  // Read JSON input from stdin
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  const toolArgs = JSON.parse(Buffer.concat(chunks).toString());

  // readPath is the path to the file that Claude is trying to read
  const readPath =
    toolArgs.tool_input?.file_path || toolArgs.tool_input?.path || "";

  // Define sensitive file patterns
  const sensitivePatterns = [
    /\.env$/i,
    /\.env\./i,
    /credentials/i,
    /\.aws\/credentials/i,
    /\.ssh\/id_rsa/i,
    /\.ssh\/id_ed25519/i,
    /\.pem$/i,
    /\.key$/i,
    /\.pfx$/i,
    /\.p12$/i,
    /secret/i,
    /password/i,
    /token/i,
  ];

  // Check if the file path matches any sensitive patterns
  if (readPath) {
    for (const pattern of sensitivePatterns) {
      if (pattern.test(readPath)) {
        // Block the operation by exiting with code 2
        console.error(`Access to sensitive file blocked: ${readPath}`);
        console.error('This file contains sensitive information (credentials, keys, or environment variables).');
        process.exit(2);
      }
    }
  }

  // Allow the operation by exiting with code 0
  process.exit(0);
}

main().catch((error) => {
  console.error(`Hook error: ${error.message}`);
  process.exit(1);
});
