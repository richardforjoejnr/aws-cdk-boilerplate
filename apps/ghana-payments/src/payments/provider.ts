import type { PaymentStatus } from '../shared/types.js';
import { MockMomoProvider } from './mock-provider.js';

/**
 * The provider seam (D1). MockMomoProvider now; MtnSandboxProvider is a drop-in later.
 * Nothing outside this module may import a concrete provider.
 */
export interface InitiatePaymentRequest {
  paymentId: string;
  merchantId: string;
  payerPhone: string;
  amountPesewas: number;
}

export interface PaymentProviderAdapter {
  /** Kick off collection; async — outcome arrives via webhook (or sweeper on silence). */
  initiatePayment(req: InitiatePaymentRequest): Promise<{ providerRef: string }>;
  /** Poll fallback for /verify. */
  getStatus(providerRef: string): Promise<PaymentStatus>;
}

export function getProvider(name: string): PaymentProviderAdapter {
  switch (name) {
    case 'mock':
      return new MockMomoProvider();
    default:
      throw new Error(`Unknown payment provider: ${name}`);
  }
}
