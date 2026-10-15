import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { money, shortDate } from '@/lib/format';
import { useStore } from '@/lib/store';
import { base, useTheme } from '@/lib/theme';

/** Orders placed from this phone (kept on the device; no account needed). */
export default function OrdersScreen() {
  const { recentOrders, config } = useStore();
  const t = useTheme();
  return (
    <FlatList
      data={recentOrders}
      keyExtractor={(o) => o.token}
      contentContainerStyle={{ padding: 16, gap: 10 }}
      ListEmptyComponent={<Text style={styles.muted}>Orders you place will show here.</Text>}
      renderItem={({ item: o }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/order/[token]', params: { token: o.token } })}
          style={({ pressed }) => [styles.card, pressed && { backgroundColor: t.primarySoft }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Order #{o.number}</Text>
            <Text style={styles.muted}>{shortDate(o.placedAt)}</Text>
          </View>
          <Text style={styles.amount}>{money(o.totalMinor, config?.currency)}</Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: base.line, backgroundColor: base.surface },
  title: { fontSize: 16, fontWeight: '700', color: base.ink },
  muted: { fontSize: 14, color: base.muted },
  amount: { fontSize: 15, fontWeight: '700', color: base.ink, fontVariant: ['tabular-nums'] },
});
