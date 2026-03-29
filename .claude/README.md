# Claude Code Configuration

This directory contains Claude Code settings and hooks for the project.

## Security-First Approach

This project follows Claude Code's security best practices by using **absolute paths** for hook scripts. This mitigates:
- Path interception attacks
- Binary planting attacks
- Unintended script execution

## File Structure

```
.claude/
├── README.md                        # This file
├── settings.example.json            # Template with $PWD placeholders (version controlled)
├── settings.local.json              # Generated with absolute paths (gitignored)
├── settings.json                    # Old settings file (gitignored, deprecated)
└── hooks/
    ├── block-sensitive-files.js     # PreToolUse: Prevent access to sensitive files
    └── typescript-type-check.cjs    # PostToolUse: Check for TypeScript errors after edits
```

## Setup Instructions

### First Time Setup

When you first clone this repository, run:

```bash
npm run setup
```

This will:
1. Install all dependencies
2. Run `scripts/init-claude.cjs` which:
   - Reads `.claude/settings.example.json`
   - Replaces `$PWD` placeholders with your absolute project path
   - Creates `.claude/settings.local.json` with resolved paths

### Why Two Settings Files?

- **`settings.example.json`** - Committed to git, contains `$PWD` placeholders
- **`settings.local.json`** - Gitignored, contains absolute paths specific to your machine

This approach allows us to:
- ✅ Share hook configurations across the team
- ✅ Use secure absolute paths (recommended)
- ✅ Avoid path conflicts between different machines

## Hooks

### 1. Block Sensitive Files Hook (PreToolUse)

**Location:** `.claude/hooks/block-sensitive-files.js`
**Triggers on:** `Read | Grep` tool calls (before execution)
**Purpose:** Prevents Claude from accessing sensitive files

**Blocked file patterns:**
- `.env` and `.env.*` files
- `credentials` files
- AWS credentials (`~/.aws/credentials`)
- SSH private keys (`id_rsa`, `id_ed25519`)
- Certificate files (`.pem`, `.key`, `.pfx`, `.p12`)
- Files containing `secret`, `password`, or `token`

**How it works:**
1. Intercepts `Read` and `Grep` tool calls before execution
2. Checks if the file path matches sensitive patterns
3. Exits with code 2 to block access (sends error to Claude)
4. Exits with code 0 to allow access

**Customizing blocked patterns:**

Edit `.claude/hooks/block-sensitive-files.js` and modify the `sensitivePatterns` array:

```javascript
const sensitivePatterns = [
  /\.env$/i,
  /\.env\./i,
  /credentials/i,
  // Add your patterns here
];
```

### 2. TypeScript Type Checking Hook (PostToolUse)

**Location:** `.claude/hooks/typescript-type-check.cjs`
**Triggers on:** `Edit` tool calls on `.ts` or `.tsx` files (after execution)
**Purpose:** Automatically checks for TypeScript type errors after editing files

**The problem this solves:**
When Claude modifies a function signature, it often doesn't update all the call sites throughout your project. This hook catches those errors immediately.

**How it works:**
1. Triggers after Claude edits any TypeScript file
2. Runs `npx tsc --noEmit` to check for type errors
3. Captures any type errors found
4. Feeds the errors back to Claude immediately
5. Claude can then fix the errors in other files

**Example scenario:**
```typescript
// Claude edits schema.ts and adds a 'verbose' parameter
function processData(data: string, verbose: boolean) { ... }

// But forgets to update main.ts
processData('hello'); // ❌ Type error: Expected 2 arguments, but got 1

// Hook detects this and tells Claude to fix main.ts
```

**Benefits:**
- ✅ Catches type errors immediately after edits
- ✅ Prevents broken code from being committed
- ✅ Keeps your entire codebase type-safe
- ✅ Reduces manual testing and debugging

**Customization:**
The hook only runs on `.ts` and `.tsx` files. To modify this behavior, edit the file extension check in `.claude/hooks/typescript-type-check.cjs`.

## Troubleshooting

### Hook not working after git clone

Run `npm run setup` to regenerate `settings.local.json` with correct absolute paths.

### "Hook error" messages

Check that:
1. The hook script exists at `.claude/hooks/block-sensitive-files.js`
2. The hook script is executable: `chmod +x .claude/hooks/block-sensitive-files.js`
3. Node.js is installed and accessible

### Need to temporarily disable hooks

Rename or delete `.claude/settings.local.json` (you can regenerate it with `npm run setup`).

## References

- [Claude Code Hooks Documentation](https://docs.claude.com/claude-code/hooks)
- [Claude Code Security Best Practices](https://docs.claude.com/claude-code/security)
