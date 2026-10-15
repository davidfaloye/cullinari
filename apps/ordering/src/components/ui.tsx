import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { base, useTheme } from '@/lib/theme';

export function Button({
  label,
  onPress,
  disabled,
  loading,
  variant = 'primary',
  trailing,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'ghost' | 'danger';
  trailing?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const bg = variant === 'primary' ? t.primary : 'transparent';
  const fg = variant === 'primary' ? t.onPrimary : variant === 'danger' ? t.bad : t.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: variant === 'primary' ? bg : variant === 'danger' ? t.bad : t.line },
        (disabled || loading) && { opacity: 0.5 },
        pressed && { opacity: 0.85 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>
          {trailing && <Text style={[styles.buttonText, { color: fg }]}>{trailing}</Text>}
        </>
      )}
    </Pressable>
  );
}

export function Stepper({ value, onChange, min = 0, max = 50, size = 'md' }: { value: number; onChange: (n: number) => void; min?: number; max?: number; size?: 'sm' | 'md' }) {
  const t = useTheme();
  const dim = size === 'sm' ? 32 : 44;
  const btn = (label: string, next: number, disabled: boolean, a11y: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      disabled={disabled}
      onPress={() => onChange(next)}
      hitSlop={6}
      style={[styles.stepBtn, { width: dim, height: dim, borderColor: t.line, opacity: disabled ? 0.35 : 1 }]}
    >
      <Text style={[styles.stepText, { color: t.primary, fontSize: size === 'sm' ? 18 : 22 }]}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={styles.stepper}>
      {btn('−', value - 1, value <= min, 'Decrease quantity')}
      <Text style={[styles.stepValue, { minWidth: size === 'sm' ? 24 : 36 }]} accessibilityLabel={`Quantity ${value}`}>{value}</Text>
      {btn('+', value + 1, value >= max, 'Increase quantity')}
    </View>
  );
}

export function Banner({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'bad' | 'brand'; children: ReactNode }) {
  const t = useTheme();
  const colors = {
    info: { bg: t.surface2, fg: t.ink },
    warn: { bg: base.warnSoft, fg: base.warn },
    bad: { bg: base.badSoft, fg: base.bad },
    brand: { bg: t.accent, fg: t.onAccent },
  }[tone];
  return (
    <View style={[styles.banner, { backgroundColor: colors.bg }]} accessibilityRole="alert">
      {typeof children === 'string' ? <Text style={[styles.bannerText, { color: colors.fg }]}>{children}</Text> : children}
    </View>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const t = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: t.surface2 }]} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, on && { backgroundColor: t.primary }]}
          >
            <Text style={[styles.segmentText, { color: on ? t.onPrimary : t.muted }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export const styles = StyleSheet.create({
  button: { minHeight: 52, borderRadius: 999, borderWidth: 1.5, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  buttonText: { fontSize: 16, fontWeight: '700', textAlign: 'center', flexGrow: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: { borderRadius: 999, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontWeight: '700', lineHeight: 26 },
  stepValue: { fontSize: 17, fontWeight: '700', textAlign: 'center', fontVariant: ['tabular-nums'], color: base.ink },
  banner: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  bannerText: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  segmented: { flexDirection: 'row', borderRadius: 999, padding: 4 },
  segment: { flex: 1, borderRadius: 999, paddingVertical: 10, alignItems: 'center' },
  segmentText: { fontWeight: '700', fontSize: 15 },
  sectionTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: base.muted, marginBottom: 8 },
});
