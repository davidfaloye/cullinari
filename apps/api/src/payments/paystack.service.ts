import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { AppConfig, CONFIG } from '../config';
import { safeEqual } from '../common/crypto';

export interface PaystackInit {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

export interface PaystackVerify {
  status: string; // success | failed | abandoned | ...
  amountMinor: number;
  currency: string;
  raw: unknown;
}

/**
 * Thin Paystack client. Each restaurant uses its own Paystack account (its secret key is
 * stored encrypted in tenant_settings), so customer money settles straight to the restaurant.
 * Food is a physical good, so card payments go through Paystack, not in-app purchase.
 */
@Injectable()
export class PaystackService {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  async initialize(
    secretKey: string,
    p: { email: string; amountMinor: number; currency: string; reference: string; callbackUrl?: string; metadata?: unknown },
  ): Promise<PaystackInit> {
    const res = await fetch(`${this.config.PAYSTACK_BASE_URL}/transaction/initialize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: p.email,
        amount: p.amountMinor,
        currency: p.currency,
        reference: p.reference,
        callback_url: p.callbackUrl,
        metadata: p.metadata,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      status?: boolean;
      message?: string;
      data?: { authorization_url: string; access_code: string; reference: string };
    };
    if (!res.ok || !json.status || !json.data) {
      throw new Error(`Paystack initialize failed: ${json.message ?? res.status}`);
    }
    return {
      authorizationUrl: json.data.authorization_url,
      accessCode: json.data.access_code,
      reference: json.data.reference,
    };
  }

  async verify(secretKey: string, reference: string): Promise<PaystackVerify> {
    const res = await fetch(`${this.config.PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      status?: boolean;
      message?: string;
      data?: { status: string; amount: number; currency: string };
    };
    if (!res.ok || !json.status || !json.data) {
      throw new Error(`Paystack verify failed: ${json.message ?? res.status}`);
    }
    return { status: json.data.status, amountMinor: json.data.amount, currency: json.data.currency, raw: json.data };
  }

  /** Paystack signs webhooks with HMAC-SHA512 of the raw body using the secret key. */
  isValidSignature(rawBody: Buffer, signature: string | undefined, secretKey: string): boolean {
    if (!signature) return false;
    const expected = createHmac('sha512', secretKey).update(rawBody).digest('hex');
    return safeEqual(expected, signature);
  }
}
