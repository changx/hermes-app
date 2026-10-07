import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ConnectionScope, Notice, routeConnection } from '../../../App';
import { SessionOptionsScreen } from '../../../SessionOptions';
import { routeId } from '../../../routeId';

export default function SessionOptions() {
  const { threadId: rawId, connection } = useLocalSearchParams<{ threadId: string; connection?: string | string[] }>();
  const id = routeId(rawId), slot = routeConnection(connection);
  if (!id || !slot) return <Notice text="This conversation is unavailable." />;
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#f2f5f9' }} edges={['bottom', 'left', 'right']}>
    <ConnectionScope slot={slot} fallback={<Notice text="This conversation is unavailable." />}><SessionOptionsScreen threadId={id} /></ConnectionScope>
  </SafeAreaView>;
}
