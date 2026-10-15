import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OrderStatus } from '@cullinari/shared';
import { AppConfig, CONFIG } from '../config';

const MESSAGES: Partial<Record<OrderStatus, string>> = {
  accepted: 'Your order has been accepted.',
  preparing: 'Your order is being prepared.',
  ready: 'Your order is ready.',
  out_for_delivery: 'Your order is on its way.',
  completed: 'Your order is complete. Enjoy!',
  cancelled: 'Your order was cancelled.',
};

/**
 * Order-status push notifications through Expo's push service. Fire and forget: a failed
 * push never blocks or fails a status change.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger('Push');

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  orderStatus(pushToken: string | null, restaurantName: string, orderNumber: number, status: OrderStatus, trackingToken: string) {
    const body = MESSAGES[status];
    if (!pushToken || !body || !pushToken.startsWith('ExponentPushToken')) return;
    void fetch(this.config.EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        to: pushToken,
        title: `${restaurantName} · Order #${orderNumber}`,
        body,
        data: { trackingToken, status },
        sound: 'default',
      }),
    })
      .then((r) => {
        if (!r.ok) this.logger.warn(`Expo push returned ${r.status}`);
      })
      .catch((err) => this.logger.warn(`Expo push failed: ${String(err)}`));
  }
}
