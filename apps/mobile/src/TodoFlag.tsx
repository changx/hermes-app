import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

/** Orange flag on a session row: the session is marked as todo. */
export function TodoFlag() {
  return <View accessible accessibilityRole="image" accessibilityLabel="Todo" style={s.flag}>
    <SymbolView name={{ ios: 'flag.fill', android: 'flag' }} size={13} tintColor={TODO_COLOR} fallback={<View style={s.fallback} />} />
  </View>;
}
export const TODO_COLOR = '#d9480f';
const s = StyleSheet.create({ flag: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' }, fallback: { width: 8, height: 8, borderRadius: 2, backgroundColor: TODO_COLOR } });
