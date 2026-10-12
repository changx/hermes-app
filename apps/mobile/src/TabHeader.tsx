import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { HeaderActions } from './App';
import { Text } from './FontSize';

/**
 * Header row of one bottom tab. NativeTabs draws no header, so each tab owns
 * its title and actions; Settings stays at the right edge on every tab.
 */
export function TabHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  const router = useRouter();
  return <View style={s.header}>
    <Text accessibilityRole="header" numberOfLines={1} style={s.title}>{title}</Text>
    <View style={s.actions}>
      {children}
      <HeaderActions onSettings={() => router.push('/settings')} />
    </View>
  </View>;
}

const s = StyleSheet.create({
  header: { paddingLeft: 16, paddingRight: 8, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 6, borderBottomWidth: 1, borderColor: '#e2e8f0' },
  title: { flex: 1, fontSize: 19, fontWeight: '700', color: '#14283e' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
});
