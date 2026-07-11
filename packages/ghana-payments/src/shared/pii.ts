import { createHash } from 'node:crypto';

/**
 * Sensitive identifiers (phone/MSISDN, ghana_card) are stored and logged only as
 * deterministic hashes (package CLAUDE.md). Deterministic so the same phone maps to
 * the same wallet/merchant record; PoC uses a static pepper, production would use KMS.
 */
export function hashPii(value: string): string {
  return createHash('sha256').update(`ghana-poc:${value.trim()}`).digest('hex').slice(0, 32);
}
