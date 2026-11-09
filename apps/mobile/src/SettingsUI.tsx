import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { Text } from './FontSize';

/**
 * Leveled settings in the style of iOS Settings: a page holds grouped
 * sections; a navigation row opens the next level as a native Stack page.
 */
export function SettingsPage({ children }: { children: React.ReactNode }) {
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>{children}</ScrollView>;
}

export function SettingsSection({ title, footer, children, plain = false }: { title?: string; footer?: string; children: React.ReactNode; plain?: boolean }) {
  return <View style={styles.section}>
    {!!title && <Text accessibilityRole="header" style={styles.title}>{title}</Text>}
    <View style={plain ? styles.plain : styles.group}>{children}</View>
    {!!footer && <Text style={styles.footer}>{footer}</Text>}
  </View>;
}

/** A row that opens the next settings level. */
export function SettingsRow({ title, value, detail, issue = false, onPress, label, first = false }: {
  title: string; value?: string; detail?: string; issue?: boolean; onPress: () => void; label?: string; first?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label ?? [title, value, detail].filter(Boolean).join(', ')} onPress={onPress}
    style={({ pressed }) => [styles.row, !first && styles.divider, pressed && styles.pressed]}>
    <View style={styles.rowText}>
      <Text numberOfLines={1} style={styles.rowTitle}>{title}</Text>
      {!!detail && <Text numberOfLines={1} style={styles.rowDetail}>{detail}</Text>}
    </View>
    {!!value && <Text numberOfLines={1} style={[styles.rowValue, issue && styles.issue]}>{value}</Text>}
    <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right' }} size={14} tintColor="#9aa8ba" weight="semibold" fallback={<Text style={styles.chevron}>›</Text>} />
  </Pressable>;
}

/** A read-only row: a title with an optional detail line, and a value. It does not open anything. */
export function SettingsValueRow({ title, value, detail, label, first = false }: {
  title: string; value: string; detail?: string; label?: string; first?: boolean;
}) {
  return <View accessible accessibilityRole="text" accessibilityLabel={label ?? [title, value, detail].filter(Boolean).join(', ')}
    style={[styles.row, !first && styles.divider]}>
    <View style={styles.rowText}>
      <Text numberOfLines={1} style={styles.rowTitle}>{title}</Text>
      {!!detail && <Text numberOfLines={1} style={styles.rowDetail}>{detail}</Text>}
    </View>
    <Text numberOfLines={1} style={styles.rowValue}>{value}</Text>
  </View>;
}

/** Static content inside a grouped section (form, picker, notice). */
export function SettingsBlock({ children, first = false }: { children: React.ReactNode; first?: boolean }) {
  return <View style={[styles.block, !first && styles.divider]}>{children}</View>;
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40, gap: 26, backgroundColor: '#f2f5f9' },
  section: { gap: 7 },
  title: { fontSize: 13, fontWeight: '600', color: '#607187', textTransform: 'uppercase', letterSpacing: 0.4, paddingHorizontal: 4 },
  group: { backgroundColor: '#fff', borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: '#d5dde8', overflow: 'hidden' },
  plain: { gap: 10 },
  footer: { fontSize: 13, lineHeight: 19, color: '#607187', paddingHorizontal: 4 },
  row: { minHeight: 52, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff' },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#d5dde8' },
  pressed: { backgroundColor: '#eef3fa' },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 16, color: '#172a40' },
  rowDetail: { fontSize: 13, color: '#607187', marginTop: 2 },
  rowValue: { fontSize: 15, color: '#607187', maxWidth: '45%' }, issue: { color: '#8a5300' },
  chevron: { fontSize: 20, color: '#9aa8ba' },
  block: { padding: 14, gap: 10, backgroundColor: '#fff' },
});
