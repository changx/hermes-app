import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './FontSize';

/**
 * Round floating "＋" button at the bottom right of a tab list. Channels
 * (New channel) and Recents (New conversation) use the same button.
 */
export function NewFab({ label, onPress }: { label: string; onPress: () => void }) {
  const insets = useSafeAreaInsets();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[s.fab, { bottom: 18 + insets.bottom }]}>
    <Text style={s.fabText}>＋</Text>
  </Pressable>;
}

const s = StyleSheet.create({
  fab: { position: 'absolute', right: 20, width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2960ad', shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 7 },
  fabText: { color: '#fff', fontSize: 32, lineHeight: 36 },
});
