import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ConnectionScope, Notice, SettingsRoute, routeConnection } from '../App';

export default function Settings() {
  const { connection } = useLocalSearchParams<{ connection?: string | string[] }>();
  const slot = routeConnection(connection);
  if (!slot) return <Notice text="This connection is unavailable." />;
  return <SafeAreaView style={{ flex: 1 }} edges={['bottom', 'left', 'right']}>
    <ConnectionScope slot={slot} fallback={<Notice text="This connection is unavailable." />}><SettingsRoute /></ConnectionScope>
  </SafeAreaView>;
}
