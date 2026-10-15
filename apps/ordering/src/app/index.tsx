import { useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PublicMenu } from '@cullinari/shared';
import { Banner, Button } from '@/components/ui';
import { GridCard, HeroCard, ListRow } from '@/components/MenuItemView';
import { itemCount } from '@/lib/cart-logic';
import { TENANT } from '@/lib/config';
import { money, todaysHours } from '@/lib/format';
import { useStore } from '@/lib/store';
import { base, useTheme } from '@/lib/theme';

type Item = PublicMenu['items'][number];
type Row = ({ kind: 'item'; item: Item } | { kind: 'pair'; items: Item[] } | { kind: 'hero'; item: Item }) & { key: string };

export default function MenuScreen() {
  const { config, menu, menuLoading, refresh, branchId, cart, cartNotice, dismissCartNotice, loadError, recentOrders } = useStore();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const list = useRef<SectionList<Row>>(null);
  const [activeCat, setActiveCat] = useState<string | null>(null);

  const layout = config?.app?.layout ?? TENANT.layout ?? 'list';
  const currency = config?.currency ?? 'NGN';
  const branch = config?.branches.find((b) => b.id === branchId);
  const inCart = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of cart) m.set(l.menuItemId, (m.get(l.menuItemId) ?? 0) + l.quantity);
    return m;
  }, [cart]);

  const sections = useMemo(() => {
    if (!menu) return [];
    const groups = [...menu.categories, { id: '__none', name: 'More' }]
      .map((c) => ({ id: c.id, title: c.name, items: menu.items.filter((i) => (i.categoryId ?? '__none') === c.id) }))
      .filter((g) => g.items.length);
    return groups.map((g) => {
      let rows: Row[];
      if (layout === 'grid') {
        rows = [];
        for (let i = 0; i < g.items.length; i += 2) {
          const items = g.items.slice(i, i + 2);
          rows.push({ kind: 'pair', items, key: items.map((x) => x.id).join('-') });
        }
      } else if (layout === 'featured') {
        const [first, ...rest] = g.items;
        rows = [{ kind: 'hero', item: first, key: first.id }, ...rest.map((item) => ({ kind: 'item' as const, item, key: item.id }))];
      } else {
        rows = g.items.map((item) => ({ kind: 'item' as const, item, key: item.id }));
      }
      return { key: g.id, title: g.title, data: rows };
    });
  }, [menu, layout]);

  const count = itemCount(cart);
  const subtotal = cart.reduce((s, l) => s + l.priceMinor * l.quantity, 0);
  const closedReason = !config
    ? null
    : !config.ordering.open
      ? config.ordering.reason === 'daily_limit'
        ? "We've reached today's online order limit. Please check back tomorrow."
        : "We're not taking online orders right now."
      : branch && !branch.isOpen
        ? `${branch.name} is closed right now.${todaysHours(branch.hours) ? ` ${todaysHours(branch.hours)}.` : ''}`
        : null;

  const open = (item: Item) => router.push({ pathname: '/item/[id]', params: { id: item.id } });

  if (loadError && !config) {
    return (
      <View style={[styles.center, { padding: 24, gap: 16 }]}>
        <Text style={styles.h1}>Can't load the menu</Text>
        <Text style={styles.muted}>{loadError}</Text>
        <Button label="Try again" onPress={() => void refresh()} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerRight: () =>
            recentOrders.length ? (
              <Pressable accessibilityRole="button" hitSlop={10} onPress={() => router.push('/orders')}>
                <Text style={{ color: t.onPrimary, fontWeight: '700', fontSize: 15 }}>Orders</Text>
              </Pressable>
            ) : null,
        }}
      />
      <SectionList
        ref={list}
        sections={sections}
        keyExtractor={(row, i) => row?.key ?? String(i)}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={menuLoading} onRefresh={() => void refresh()} tintColor={t.primary} />}
        contentContainerStyle={{ paddingBottom: count ? 110 + insets.bottom : 32 + insets.bottom }}
        onViewableItemsChanged={({ viewableItems }) => {
          const first = viewableItems.find((v) => v.section);
          if (first?.section) setActiveCat((first.section as { key: string }).key);
        }}
        ListHeaderComponent={
          <View style={{ gap: 12, paddingTop: 12 }}>
            {config && config.branches.length > 1 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Branch: ${branch?.name ?? 'choose'}. Change branch`}
                onPress={() => router.push('/branch')}
                style={[styles.branch, { borderColor: t.line }]}
              >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.small}>Ordering from</Text>
                    <Text style={styles.branchName}>{branch?.name ?? 'Choose a branch'}</Text>
                  </View>
                  <Text style={{ color: t.primary, fontWeight: '700' }}>Change</Text>
              </Pressable>
            )}
            {closedReason && <View style={styles.pad}><Banner tone="warn">{closedReason}</Banner></View>}
            {config?.app?.promoText && <View style={styles.pad}><Banner tone="brand">{config.app.promoText}</Banner></View>}
            {cartNotice && (
              <Pressable style={styles.pad} onPress={dismissCartNotice} accessibilityHint="Dismiss">
                <Banner tone="info">{cartNotice}</Banner>
              </Pressable>
            )}
            {sections.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
                {sections.map((s, i) => {
                  const on = (activeCat ?? sections[0].key) === s.key;
                  return (
                    <Pressable
                      key={s.key}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      onPress={() => list.current?.scrollToLocation({ sectionIndex: i, itemIndex: 0, viewOffset: 0, animated: true })}
                      style={[styles.chip, { borderColor: on ? t.primary : t.line, backgroundColor: on ? t.primary : base.surface }]}
                    >
                      <Text style={{ color: on ? t.onPrimary : base.ink, fontWeight: '700' }}>{s.title}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
            {!menu && <Text style={[styles.muted, styles.pad]}>Loading menu…</Text>}
            {menu && menu.items.length === 0 && <Text style={[styles.muted, styles.pad]}>The menu is being updated. Check back soon.</Text>}
          </View>
        }
        renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
        renderItem={({ item: row }) => {
          if (row.kind === 'pair') {
            return (
              <View style={styles.pairRow}>
                {row.items.map((i) => <GridCard key={i.id} item={i} currency={currency} inCart={inCart.get(i.id) ?? 0} onPress={() => open(i)} />)}
                {row.items.length === 1 && <View style={{ flex: 1 }} />}
              </View>
            );
          }
          if (row.kind === 'hero') return <HeroCard item={row.item} currency={currency} inCart={inCart.get(row.item.id) ?? 0} onPress={() => open(row.item)} />;
          return <ListRow item={row.item} currency={currency} inCart={inCart.get(row.item.id) ?? 0} onPress={() => open(row.item)} />;
        }}
        ItemSeparatorComponent={layout === 'grid' ? undefined : () => <View style={[styles.sep, { backgroundColor: t.line }]} />}
      />

      {count > 0 && (
        <View style={[styles.cartBar, { paddingBottom: 12 + insets.bottom }]}>
          <Button label={`View order · ${count} item${count === 1 ? '' : 's'}`} trailing={money(subtotal, currency)} onPress={() => router.push('/cart')} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  h1: { fontSize: 22, fontWeight: '800', color: base.ink, textAlign: 'center' },
  muted: { color: base.muted, fontSize: 15, textAlign: 'center' },
  small: { fontSize: 12, color: base.muted, fontWeight: '600' },
  pad: { paddingHorizontal: 16 },
  branch: { marginHorizontal: 16, padding: 14, borderRadius: 14, borderWidth: 1, backgroundColor: base.surface, flexDirection: 'row', alignItems: 'center', gap: 12 },
  branchName: { fontSize: 16, fontWeight: '700', color: base.ink },
  chip: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, borderWidth: 1.5 },
  sectionHeader: { fontSize: 20, fontWeight: '800', color: base.ink, paddingHorizontal: 16, paddingTop: 22, paddingBottom: 6 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  pairRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 6 },
  cartBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, backgroundColor: 'rgba(247,247,245,0.96)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: base.line },
});
