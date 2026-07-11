import { createHash } from 'node:crypto';

/**
 * Sensitive identifiers (phone/MSISDN, ghana_card) are stored and logged only as
 * deterministic hashes (package CLAUDE.md). Deterministic so the same phone maps to
 * the same wallet/merchant record; PoC uses a static pepper, production would use KMS.
 */
export function hashPii(value: string): string {
  return createHash('sha256').update(`ghana-poc:${value.trim()}`).digest('hex').slice(0, 32);
}

/**
 * Canonical wallet key from a phone number. Wallet endpoints receive the phone in the
 * URL path (API Gateway leaves it percent-encoded, e.g. `+233` → `%2B233`) while
 * payment initiation receives it decoded in the JSON body — hashing them raw made a
 * top-up and its payment key different wallets (top-up worked, payment always 402).
 * Safe-decode + strip all whitespace so every path keys the same wallet.
 */
export function hashPhone(rawPhone: string): string {
  let decoded = rawPhone;
  try {
    decoded = decodeURIComponent(rawPhone);
  } catch {
    // malformed %-sequence: use the raw value
  }
  return hashPii(decoded.replace(/\s+/g, ''));
}
