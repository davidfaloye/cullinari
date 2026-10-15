import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { PublicMenu } from '@cullinari/shared';
import { money } from '@/lib/format';
import { base, useTheme } from '@/lib/theme';

type Item = PublicMenu['items'][number];

interface Props {
  item: Item;
  currency: string;
  inCart: number;
  onPress: () => void;
}

function Placeholder({ name, size }: { name: string; size: number }) {
  const t = useTheme();
  return (
    <View style={{ width: '100%', height: size, backgroundColor: t.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size / 3, fontWeight: '800', color: t.primary }}>{name.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

function Photo({ item, size, radius }: { item: Item; size: number; radius: number }) {
  return (
    <View style={{ width: '100%', height: size, borderRadius: radius, overflow: 'hidden' }}>
      {item.imageUrl ? (
        <Image source={{ uri: item.imageUrl }} style={{ width: '100%', height: size }} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />
      ) : (
        <Placeholder name={item.name} size={size} />
      )}
    </View>
  );
}

function Count({ n }: { n: number }) {
  const t = useTheme();
  if (!n) return null;
  return (
    <View style={[s.count, { backgroundColor: t.primary }]}>
      <Text style={{ color: t.onPrimary, fontWeight: '800', fontSize: 12 }}>{n}</Text>
    </View>
  );
}

const a11y = (item: Item, currency: string, inCart: number) =>
  `${item.name}, ${money(item.priceMinor, currency)}${item.isAvailable ? '' : ', sold out'}${inCart ? `, ${inCart} in your order` : ''}`;

/** Standard list row: the Starter layout, and the default everywhere. */
export function ListRow({ item, currency, inCart, onPress }: Props) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y(item, currency, inCart)} onPress={onPress} disabled={!item.isAvailable} style={({ pressed }) => [s.row, pressed && { backgroundColor: t.surface2 }]}>
      <View style={{ flex: 1, gap: 4, opacity: item.isAvailable ? 1 : 0.5 }}>
        <Text style={s.name}>{item.name}</Text>
        {item.description ? <Text style={s.desc} numberOfLines={2}>{item.description}</Text> : null}
        <Text style={[s.price, { color: t.ink }]}>{item.isAvailable ? money(item.priceMinor, currency) : 'Sold out'}</Text>
      </View>
      <View style={{ width: 84, opacity: item.isAvailable ? 1 : 0.5 }}>
        <Photo item={item} size={84} radius={12} />
        <Count n={inCart} />
      </View>
    </Pressable>
  );
}

/** Two-column cards (Growth "grid" layout). */
export function GridCard({ item, currency, inCart, onPress }: Props) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y(item, currency, inCart)} onPress={onPress} disabled={!item.isAvailable} style={({ pressed }) => [s.card, { borderColor: t.line, opacity: item.isAvailable ? (pressed ? 0.85 : 1) : 0.5 }]}>
      <Photo item={item} size={120} radius={0} />
      <Count n={inCart} />
      <View style={{ padding: 10, gap: 2 }}>
        <Text style={s.name} numberOfLines={2}>{item.name}</Text>
        <Text style={s.price}>{item.isAvailable ? money(item.priceMinor, currency) : 'Sold out'}</Text>
      </View>
    </Pressable>
  );
}

/** Large hero card used for the first item of each category (Growth "featured" layout). */
export function HeroCard({ item, currency, inCart, onPress }: Props) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y(item, currency, inCart)} onPress={onPress} disabled={!item.isAvailable} style={({ pressed }) => [s.hero, { borderColor: t.line, opacity: item.isAvailable ? (pressed ? 0.9 : 1) : 0.5 }]}>
      <Photo item={item} size={180} radius={0} />
      <Count n={inCart} />
      <View style={{ padding: 14, gap: 4 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
          <Text style={[s.name, { fontSize: 18, flex: 1 }]}>{item.name}</Text>
          <Text style={[s.price, { fontSize: 16 }]}>{item.isAvailable ? money(item.priceMinor, currency) : 'Sold out'}</Text>
        </View>
        {item.description ? <Text style={s.desc}>{item.description}</Text> : null}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 14, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center' },
  name: { fontSize: 16, fontWeight: '700', color: base.ink },
  desc: { fontSize: 14, color: base.muted, lineHeight: 19 },
  price: { fontSize: 15, fontWeight: '700', color: base.ink, fontVariant: ['tabular-nums'] },
  card: { flex: 1, backgroundColor: base.surface, borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  hero: { backgroundColor: base.surface, borderRadius: 16, borderWidth: 1, overflow: 'hidden', marginHorizontal: 16, marginVertical: 8 },
  count: { position: 'absolute', top: 8, right: 8, minWidth: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
});
