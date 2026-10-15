import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Stepper } from '@/components/ui';
import { money } from '@/lib/format';
import { useStore } from '@/lib/store';
import { base, useTheme } from '@/lib/theme';

export default function ItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { menu, config, addToCart } = useStore();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const item = menu?.items.find((i) => i.id === id);
  const currency = config?.currency ?? 'NGN';
  // Per-item notes are an extra app option on Growth and Pro.
  const notesOn = !!config?.app?.options?.item_notes;

  if (!item) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={styles.desc}>This item is no longer on the menu.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {item.imageUrl ? (
          <Image source={{ uri: item.imageUrl }} style={{ width: '100%', aspectRatio: 4 / 3 }} contentFit="cover" accessibilityIgnoresInvertColors />
        ) : (
          <View style={{ width: '100%', aspectRatio: 2, backgroundColor: t.primarySoft }} />
        )}
        <View style={{ padding: 20, gap: 10 }}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.price}>{money(item.priceMinor, currency)}</Text>
          {item.description ? <Text style={styles.desc}>{item.description}</Text> : null}
          {notesOn && (
            <View style={{ gap: 6, marginTop: 10 }}>
              <Text style={styles.label}>Special request</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="e.g. no onions, extra pepper"
                placeholderTextColor={base.muted}
                maxLength={200}
                style={[styles.input, { borderColor: base.line }]}
              />
            </View>
          )}
        </View>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: 12 + insets.bottom }]}>
        <Stepper value={qty} onChange={setQty} min={1} />
        <Button
          style={{ flex: 1 }}
          label={item.isAvailable ? 'Add' : 'Sold out'}
          trailing={item.isAvailable ? money(item.priceMinor * qty, currency) : undefined}
          disabled={!item.isAvailable}
          onPress={() => {
            addToCart(item, qty, notesOn ? note : undefined);
            router.back();
          }}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 26, fontWeight: '800', color: base.ink },
  price: { fontSize: 18, fontWeight: '700', color: base.ink, fontVariant: ['tabular-nums'] },
  desc: { fontSize: 16, color: base.muted, lineHeight: 23 },
  label: { fontSize: 14, fontWeight: '700', color: base.ink },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, backgroundColor: base.surface, color: base.ink },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: base.line, backgroundColor: base.bg },
});
