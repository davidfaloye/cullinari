import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Banner, Button, Stepper } from '@/components/ui';
import { money } from '@/lib/format';
import { useStore } from '@/lib/store';
import { base } from '@/lib/theme';

export default function CartScreen() {
  const { cart, setLineQuantity, config, cartNotice, dismissCartNotice } = useStore();
  const insets = useSafeAreaInsets();
  const currency = config?.currency ?? 'NGN';
  const subtotal = cart.reduce((s, l) => s + l.priceMinor * l.quantity, 0);

  if (!cart.length) {
    return (
      <View style={styles.empty}>
        <Text style={styles.h2}>Your order is empty</Text>
        <Button label="Browse the menu" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {cartNotice && <Banner>{cartNotice}</Banner>}
        <View style={styles.card}>
          {cart.map((l, i) => (
            <View key={l.key} style={[styles.line, i > 0 && styles.divider]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.name}>{l.name}</Text>
                {l.note ? <Text style={styles.note}>{l.note}</Text> : null}
                <Text style={styles.price}>{money(l.priceMinor * l.quantity, currency)}</Text>
              </View>
              <Stepper size="sm" value={l.quantity} onChange={(n) => setLineQuantity(l.key, n)} />
            </View>
          ))}
        </View>
        <View style={[styles.card, styles.line]}>
          <Text style={[styles.name, { flex: 1 }]}>Subtotal</Text>
          <Text style={styles.price}>{money(subtotal, currency)}</Text>
        </View>
        <Text style={styles.note}>Delivery fee and any tax are shown at checkout.</Text>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: 12 + insets.bottom }]}>
        <Button
          label="Go to checkout"
          trailing={money(subtotal, currency)}
          onPress={() => {
            dismissCartNotice();
            router.push('/checkout');
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  h2: { fontSize: 20, fontWeight: '800', color: base.ink },
  card: { backgroundColor: base.surface, borderRadius: 14, borderWidth: 1, borderColor: base.line, paddingHorizontal: 16 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: base.line },
  name: { fontSize: 16, fontWeight: '700', color: base.ink },
  note: { fontSize: 14, color: base.muted },
  price: { fontSize: 15, fontWeight: '700', color: base.ink, fontVariant: ['tabular-nums'] },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: base.line },
});
