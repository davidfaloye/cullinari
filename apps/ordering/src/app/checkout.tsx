import { useMemo, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { priceCart, type FulfilmentType, type PaymentMethod } from '@cullinari/shared';
import { Banner, Button, SectionTitle, Segmented } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { toOrderItems } from '@/lib/cart-logic';
import { money } from '@/lib/format';
import { registerForOrderUpdates } from '@/lib/notifications';
import { useStore } from '@/lib/store';
import { base, useTheme } from '@/lib/theme';

const PHONE = /^\+?[0-9 ()-]{7,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function CheckoutScreen() {
  const { config, cart, branchId, customer, saveCustomer, clearCart, rememberOrder, refresh } = useStore();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const options = config?.app?.options ?? {};
  const branch = config?.branches.find((b) => b.id === branchId);
  const currency = config?.currency ?? 'NGN';

  const fulfilmentChoices: FulfilmentType[] = options.pickup_only ? ['pickup'] : options.delivery_only ? ['delivery'] : ['delivery', 'pickup'];
  const paymentChoices: PaymentMethod[] = [
    ...(config?.payments.paystack ? (['paystack'] as const) : []),
    ...(config?.payments.payOnDelivery ? (['pay_on_delivery'] as const) : []),
  ];

  const [fulfilment, setFulfilment] = useState<FulfilmentType>(fulfilmentChoices[0]);
  const [payment, setPayment] = useState<PaymentMethod | undefined>(paymentChoices[0]);
  const [form, setForm] = useState({ ...customer, note: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const totals = useMemo(
    () => priceCart(cart, { fulfilment, deliveryFeeMinor: config?.deliveryFeeMinor ?? 0, taxRateBps: config?.taxRateBps ?? 0 }),
    [cart, fulfilment, config],
  );

  const blocked = !config?.ordering.open
    ? "We're not taking online orders right now."
    : branch && !branch.isOpen
      ? `${branch.name} is closed right now.`
      : !paymentChoices.length
        ? 'Online payment is not set up yet. Please call the restaurant.'
        : null;

  function validate() {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Enter your name';
    if (!PHONE.test(form.phone.trim())) e.phone = 'Enter a phone number the restaurant can call';
    if (form.email.trim() && !EMAIL.test(form.email.trim())) e.email = 'Check this email address';
    if (fulfilment === 'delivery' && form.address.trim().length < 5) e.address = 'Enter your delivery address';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function placeOrder() {
    if (!branchId || !payment || !validate()) return;
    setSubmitting(true);
    setFailure(null);
    const details = { name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim(), address: form.address.trim() };
    saveCustomer(details);
    try {
      // Asked here, when the customer can see why: to tell them when their food is ready.
      const pushToken = await registerForOrderUpdates();
      const returnUrl = Linking.createURL('payment');
      const placed = await api.placeOrder({
        branchId,
        fulfilment,
        paymentMethod: payment,
        items: toOrderItems(cart),
        customer: { name: details.name, phone: details.phone, ...(details.email ? { email: details.email } : {}) },
        ...(fulfilment === 'delivery' ? { deliveryAddress: details.address } : {}),
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
        ...(pushToken ? { pushToken } : {}),
        ...(payment === 'paystack' ? { returnUrl } : {}),
      });
      rememberOrder({
        token: placed.trackingToken,
        number: placed.number,
        placedAt: new Date().toISOString(),
        totalMinor: placed.totalMinor,
        paymentReference: placed.payment?.reference,
      });
      clearCart();

      if (placed.payment) {
        // Paystack's checkout page, then back into the app via the return link.
        await WebBrowser.openAuthSessionAsync(placed.payment.authorizationUrl, returnUrl);
        // The webhook usually confirms first; this covers a slow webhook.
        await api.verifyPayment(placed.payment.reference).catch(() => undefined);
      }
      router.dismissAll();
      router.push({ pathname: '/order/[token]', params: { token: placed.trackingToken } });
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'ITEM_UNAVAILABLE' || err.code === 'PLAN_LIMIT_ORDERS' || err.code === 'ORDERING_PAUSED' || err.code === 'BRANCH_CLOSED')) {
        void refresh(); // pulls the latest menu and status; the cart drops unavailable items
      }
      setFailure(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 22 }} keyboardShouldPersistTaps="handled">
        {blocked && <Banner tone="warn">{blocked}</Banner>}

        {fulfilmentChoices.length > 1 ? (
          <Segmented value={fulfilment} onChange={setFulfilment} options={[{ value: 'delivery', label: 'Delivery' }, { value: 'pickup', label: 'Pickup' }]} />
        ) : (
          <Banner>{fulfilment === 'pickup' ? 'This restaurant offers pickup only.' : 'This restaurant offers delivery only.'}</Banner>
        )}

        {branch && (
          <View>
            <SectionTitle>{fulfilment === 'pickup' ? 'Pick up from' : 'From'}</SectionTitle>
            <Text style={styles.value}>{branch.name}</Text>
            {branch.address ? <Text style={styles.muted}>{branch.address}</Text> : null}
          </View>
        )}

        <View style={{ gap: 12 }}>
          <SectionTitle>Your details</SectionTitle>
          <Field label="Name" error={errors.name} value={form.name} onChangeText={set('name')} autoComplete="name" textContentType="name" />
          <Field label="Phone" error={errors.phone} value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" placeholder="0803 000 0000" />
          <Field label="Email (optional, for your receipt)" error={errors.email} value={form.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" />
          {fulfilment === 'delivery' && (
            <Field label="Delivery address" error={errors.address} value={form.address} onChangeText={set('address')} multiline autoComplete="street-address" textContentType="fullStreetAddress" placeholder="House number, street, area, landmark" />
          )}
          <Field label="Note for the restaurant (optional)" value={form.note} onChangeText={set('note')} maxLength={300} />
        </View>

        {paymentChoices.length > 0 && (
          <View style={{ gap: 10 }}>
            <SectionTitle>Payment</SectionTitle>
            {paymentChoices.map((p) => (
              <Pressable
                key={p}
                accessibilityRole="radio"
                accessibilityState={{ selected: payment === p }}
                onPress={() => setPayment(p)}
                style={[styles.option, { borderColor: payment === p ? t.primary : base.line, borderWidth: payment === p ? 2 : 1 }]}
              >
                <View style={[styles.radio, { borderColor: payment === p ? t.primary : base.line }]}>{payment === p && <View style={[styles.dot, { backgroundColor: t.primary }]} />}</View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.value}>{p === 'paystack' ? 'Pay now with card or transfer' : fulfilment === 'pickup' ? 'Pay at pickup' : 'Pay on delivery'}</Text>
                  <Text style={styles.muted}>{p === 'paystack' ? 'Secure checkout by Paystack' : 'Cash or transfer when you get your food'}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.totals}>
          <Row label="Subtotal" value={money(totals.subtotalMinor, currency)} />
          {fulfilment === 'delivery' && <Row label="Delivery" value={totals.deliveryFeeMinor ? money(totals.deliveryFeeMinor, currency) : 'Free'} />}
          {totals.taxMinor > 0 && <Row label="Tax" value={money(totals.taxMinor, currency)} />}
          <Row label="Total" value={money(totals.totalMinor, currency)} bold />
        </View>
        {failure && <Banner tone="bad">{failure}</Banner>}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: 12 + insets.bottom }]}>
        <Button
          label={payment === 'paystack' ? 'Pay and place order' : 'Place order'}
          trailing={money(totals.totalMinor, currency)}
          loading={submitting}
          disabled={!!blocked || !cart.length}
          onPress={() => void placeOrder()}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function Field({ label, error, ...input }: { label: string; error?: string } & TextInputProps) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...input}
        accessibilityLabel={label}
        placeholderTextColor={base.muted}
        style={[styles.input, input.multiline && { minHeight: 72, textAlignVertical: 'top' }, error ? { borderColor: base.bad } : null]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }): ReactNode {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
      <Text style={[styles.muted, bold && styles.bold]}>{label}</Text>
      <Text style={[styles.amount, bold && styles.bold]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '700', color: base.ink },
  value: { fontSize: 16, fontWeight: '700', color: base.ink },
  muted: { fontSize: 14, color: base.muted },
  input: { borderWidth: 1.5, borderColor: base.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, backgroundColor: base.surface, color: base.ink },
  error: { fontSize: 13, color: base.bad, fontWeight: '600' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, backgroundColor: base.surface },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  totals: { backgroundColor: base.surface, borderRadius: 14, borderWidth: 1, borderColor: base.line, padding: 16 },
  amount: { fontSize: 15, color: base.ink, fontVariant: ['tabular-nums'] },
  bold: { fontWeight: '800', color: base.ink, fontSize: 17 },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: base.line, backgroundColor: base.bg },
});
