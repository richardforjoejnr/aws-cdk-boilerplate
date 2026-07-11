/**
 * Shared domain types for the Ghana Payments platform.
 * Derived from the concept spec: docs/concept.md (sections 9, 11, 20).
 */

// --- Status enumerations (concept.md §20) ---

export type MerchantStatus = 'PENDING_KYC' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

export type QrStatus = 'ACTIVE' | 'INACTIVE' | 'ROTATED' | 'COMPROMISED';

export type PaymentStatus =
  | 'INITIATED'
  | 'PENDING'
  | 'SUCCESS'
  | 'FAILED'
  | 'EXPIRED'
  | 'REVERSED'
  | 'REFUNDED';

export type DeviceStatus =
  | 'UNASSIGNED'
  | 'PAIRED'
  | 'ACTIVE'
  | 'OFFLINE'
  | 'SUSPENDED'
  | 'RETIRED';

export type SettlementStatus =
  | 'OPEN'
  | 'CALCULATED'
  | 'SUBMITTED'
  | 'PAID'
  | 'FAILED'
  | 'RECONCILED';

export type PaymentProvider =
  | 'MTN_MOMO'
  | 'TELECEL_CASH'
  | 'AT_MONEY'
  | 'GHANAPAY'
  | 'GHIPSS_GHQR'
  | 'SIMULATED'; // PoC simulated provider adapter

// --- Internal payment event schema (concept.md §9) ---

export type PaymentEventType =
  | 'PAYMENT_INITIATED'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_CONFIRMED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_EXPIRED'
  | 'PAYMENT_REVERSED'
  | 'PAYMENT_REFUNDED';

export interface PaymentEvent {
  event_id: string;
  event_type: PaymentEventType;
  provider: PaymentProvider;
  provider_transaction_id: string;
  payment_id: string;
  merchant_id: string;
  amount: number;
  currency: 'GHS';
  event_time: string; // ISO 8601
  raw_payload_ref?: string; // S3 URI of the raw webhook payload
}

// --- Soundbox device event (concept.md §10, §17.6) ---

export interface DeviceAnnouncement {
  event_type: 'ANNOUNCE_PAYMENT';
  payment_id: string;
  amount: number;
  currency: string;
  language: string;
  message: string;
  priority: 'HIGH' | 'NORMAL';
  ttl_seconds: number;
  timestamp: string;
}
