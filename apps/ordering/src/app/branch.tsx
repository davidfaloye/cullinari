import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { todaysHours } from '@/lib/format';
import { useStore } from '@/lib/store';
import { base, useTheme } from '@/lib/theme';

export default function BranchScreen() {
  const { config, branchId, setBranchId, cart } = useStore();
  const t = useTheme();
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
      {cart.length > 0 && <Text style={styles.note}>Items that aren't served at the branch you pick will be removed from your order.</Text>}
      {config?.branches.map((b) => {
        const on = b.id === branchId;
        return (
          <Pressable
            key={b.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => {
              setBranchId(b.id);
              router.back();
            }}
            style={[styles.card, { borderColor: on ? t.primary : base.line, borderWidth: on ? 2 : 1 }]}
          >
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.name}>{b.name}</Text>
              {b.address ? <Text style={styles.muted}>{b.address}</Text> : null}
              <Text style={[styles.muted, { color: b.isOpen ? t.primary : base.bad, fontWeight: '700' }]}>
                {b.isOpen ? 'Open now' : 'Closed now'}
                {todaysHours(b.hours) ? ` · ${todaysHours(b.hours)}` : ''}
              </Text>
            </View>
            {on && <Text style={{ color: t.primary, fontWeight: '800', fontSize: 18 }}>✓</Text>}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: base.surface, borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontSize: 17, fontWeight: '700', color: base.ink },
  muted: { fontSize: 14, color: base.muted },
  note: { fontSize: 14, color: base.muted, marginBottom: 4 },
});
