import { useCallback, useEffect, useState } from 'react';
import { Platform, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router, useLocalSearchParams } from 'expo-router';
import { CUSTOMER_STATUS_TEXT, trackingSteps, type TrackedOrder } from '@cullinari/shared';
import { Banner, Button, SectionTitle } from '@/components/ui';
import { api } from '@/lib/api';
import { money, shortDate } from '@/lib/format';
import { useStore } from '@/lib/store';
import { base, useTheme } from '@/lib/theme';

const DONE = ['completed', 'cancelled'];

export default function TrackingScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { config, recentOrders, menu, addToCart } = useStore();
  const t = useTheme();
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const saved = recentOrders.find((o) => o.token === token);
  const currency = config?.currency ?? 'NGN';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOrder(await api.track(token));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your order');
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Poll while the order is in progress; a push notification also triggers a refresh.
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (!order || !DONE.includes(order.status)) void load();
    }, 15_000);
    const sub = Platform.OS === 'web' ? null : Notifications.addNotificationReceivedListener(() => void load());
    return () => {
      clearInterval(timer);
      sub?.remove();
    };
  }, [load, order]);

  if (!order) {
    return (
      <View style={styles.center}>
        {error ? <Banner tone="bad">{error}</Banner> : <Text style={styles.muted}>Loading your order…</Text>}
        {error && <Button label="Try again" onPress={() => void load()} />}
      </View>
    );
  }

  const steps = trackingSteps(order.fulfilment);
  const current = steps.indexOf(order.status);
  const cancelled = order.status === 'cancelled';
  const awaitingPayment = order.paymentMethod === 'paystack' && order.paymentStatus === 'pending' && !cancelled;
  const reorderOn = !!config?.app?.options?.reorder_button;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 18 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={t.primary} />}>
      <View style={[styles.hero, { backgroundColor: cancelled ? base.badSoft : t.primarySoft }]}>
        <Text style={styles.small}>Order #{order.number} · {order.branchName}</Text>
        <Text style={[styles.status, { color: cancelled ? base.bad : t.primary }]}>{CUSTOMER_STATUS_TEXT[order.status]}</Text>
        <Text style={styles.small}>Placed {shortDate(order.placedAt)}</Text>
      </View>

      {awaitingPayment && (
        <View style={{ gap: 10 }}>
          <Banner tone="warn">We're waiting for your payment to be confirmed. The restaurant starts once it's through.</Banner>
          {saved?.paymentReference && (
            <Button variant="ghost" label="Check payment again" onPress={() => void api.verifyPayment(saved.paymentReference!).finally(load)} />
          )}
        </View>
      )}
      {order.paymentStatus === 'failed' && <Banner tone="bad">Your payment didn't go through. Please place the order again.</Banner>}

      {!cancelled && (
        <View accessibilityRole="progressbar" accessibilityLabel={`Status: ${CUSTOMER_STATUS_TEXT[order.status]}`}>
          {steps.map((s, i) => {
            const done = i <= current;
            return (
              <View key={s} style={styles.step}>
                <View style={{ alignItems: 'center' }}>
                  <View style={[styles.dot, { backgroundColor: done ? t.primary : base.surface2, borderColor: done ? t.primary : base.line }]} />
                  {i < steps.length - 1 && <View style={[styles.rail, { backgroundColor: i < current ? t.primary : base.line }]} />}
                </View>
                <Text style={[styles.stepText, { color: done ? base.ink : base.muted, fontWeight: i === current ? '800' : '500' }]}>{CUSTOMER_STATUS_TEXT[s]}</Text>
              </View>
            );
          })}
        </View>
      )}

      <View style={styles.card}>
        <SectionTitle>Your order</SectionTitle>
        {order.items.map((i, idx) => (
          <View key={idx} style={styles.row}>
            <Text style={styles.item}>{i.quantity}× {i.name}</Text>
            <Text style={styles.amount}>{money(i.unitPriceMinor * i.quantity, currency)}</Text>
          </View>
        ))}
        {order.deliveryFeeMinor > 0 && (
          <View style={styles.row}><Text style={styles.muted}>Delivery</Text><Text style={styles.amount}>{money(order.deliveryFeeMinor, currency)}</Text></View>
        )}
        {order.taxMinor > 0 && (
          <View style={styles.row}><Text style={styles.muted}>Tax</Text><Text style={styles.amount}>{money(order.taxMinor, currency)}</Text></View>
        )}
        <View style={[styles.row, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: base.line, marginTop: 6, paddingTop: 10 }]}>
          <Text style={[styles.item, { fontWeight: '800' }]}>Total</Text>
          <Text style={[styles.amount, { fontWeight: '800' }]}>{money(order.totalMinor, currency)}</Text>
        </View>
        <Text style={[styles.muted, { marginTop: 6 }]}>
          {order.paymentMethod === 'paystack' ? `Card · ${order.paymentStatus === 'paid' ? 'paid' : order.paymentStatus}` : order.fulfilment === 'pickup' ? 'Pay at pickup' : 'Pay on delivery'}
        </Text>
      </View>

      {reorderOn && DONE.includes(order.status) && menu && (
        <Button
          variant="ghost"
          label="Order this again"
          onPress={() => {
            for (const i of order.items) {
              const m = menu.items.find((x) => x.id === i.menuItemId && x.isAvailable);
              if (m) addToCart(m, i.quantity);
            }
            router.dismissAll();
            router.push('/cart');
          }}
        />
      )}
      <Button variant="ghost" label="Back to menu" onPress={() => router.dismissAll()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  hero: { borderRadius: 18, padding: 20, gap: 6 },
  status: { fontSize: 26, fontWeight: '800' },
  small: { fontSize: 14, color: base.muted, fontWeight: '600' },
  muted: { fontSize: 14, color: base.muted },
  step: { flexDirection: 'row', gap: 14, minHeight: 44 },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2 },
  rail: { width: 3, flex: 1, marginVertical: 2, borderRadius: 2 },
  stepText: { fontSize: 16, paddingTop: 0, lineHeight: 18 },
  card: { backgroundColor: base.surface, borderRadius: 14, borderWidth: 1, borderColor: base.line, padding: 16, gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 3 },
  item: { fontSize: 15, color: base.ink, flex: 1 },
  amount: { fontSize: 15, color: base.ink, fontVariant: ['tabular-nums'] },
});
