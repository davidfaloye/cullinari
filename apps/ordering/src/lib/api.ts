import type {
  FulfilmentType,
  PaymentMethod,
  PlacedOrder,
  PublicMenu,
  PublicRestaurantConfig,
  TrackedOrder,
} from '@cullinari/shared';
import { API_URL, TENANT } from './config';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/public/${TENANT.slug}${path}`, {
      method: init?.method ?? 'GET',
      headers: init?.body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', "Can't connect. Check your internet and try again.");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.code ?? 'INTERNAL', json.message ?? 'Something went wrong', json.details);
  return json as T;
}

export interface PlaceOrderBody {
  branchId: string;
  fulfilment: FulfilmentType;
  paymentMethod: PaymentMethod;
  items: { menuItemId: string; quantity: number; note?: string }[];
  customer: { name: string; phone: string; email?: string };
  deliveryAddress?: string;
  note?: string;
  pushToken?: string;
  returnUrl?: string;
}

export const api = {
  config: () => request<PublicRestaurantConfig>(''),
  menu: (branchId?: string) => request<PublicMenu>(`/menu${branchId ? `?branchId=${branchId}` : ''}`),
  placeOrder: (body: PlaceOrderBody) => request<PlacedOrder>('/orders', { method: 'POST', body }),
  track: (token: string) => request<TrackedOrder>(`/orders/${encodeURIComponent(token)}`),
  verifyPayment: (reference: string) =>
    request<{ status: string }>(`/payments/${encodeURIComponent(reference)}/verify`, { method: 'POST' }),
};
