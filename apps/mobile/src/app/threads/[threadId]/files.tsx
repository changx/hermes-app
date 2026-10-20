import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ConnectionScope, Notice, routeConnection, useApp } from '../../../App';
import { SessionFilesScreen } from '../../../SessionFilesScreen';
import { routeId } from '../../../routeId';

function Page({ threadId }: { threadId: string }) {
  const { client, config } = useApp();
  if (!client || !config) return <Notice text="Opening conversation…" />;
  if (!client.supportsSessionFiles) return <Notice text="This server does not list session files yet." />;
  const thread = client.threads.get(threadId);
  if (!thread || thread.archived) return <Notice text="This conversation is unavailable." />;
  return <SessionFilesScreen key={config.id + ':' + threadId} client={client} threadId={threadId} />;
}

export default function SessionFiles() {
  const { threadId: rawId, connection } = useLocalSearchParams<{ threadId: string; connection?: string | string[] }>();
  const id = routeId(rawId), slot = routeConnection(connection);
  if (!id || !slot) return <Notice text="This conversation is unavailable." />;
  return <SafeAreaView style={{ flex: 1 }} edges={['bottom', 'left', 'right']}>
    <ConnectionScope slot={slot} fallback={<Notice text="This conversation is unavailable." />}><Page threadId={id} /></ConnectionScope>
  </SafeAreaView>;
}
