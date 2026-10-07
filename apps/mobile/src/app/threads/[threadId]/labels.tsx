import React, { useCallback } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ConnectionScope, FormKeyboardAvoidingView, Notice, routeConnection, useApp } from '../../../App';
import { LabelsEditorPage } from '../../../SessionLabels';
import { routeId } from '../../../routeId';

function Page({ id }: { id: string }) {
  const router = useRouter();
  const { client, config } = useApp();
  const done = useCallback(() => { if (router.canGoBack()) router.back(); }, [router]);
  if (!client || !config) return <Notice text="Opening conversation…" />;
  const thread = client.threads.get(id);
  if (!client.supportsSessionLabels || !thread || thread.archived) return <Notice text="This conversation is unavailable." />;
  return <FormKeyboardAvoidingView><LabelsEditorPage key={config.id + ':' + id} client={client} threadId={id} onDone={done} /></FormKeyboardAvoidingView>;
}

/** Label editor for one Session, pushed from Session options or the Channel list. */
export default function SessionLabelsRoute() {
  const { threadId: rawId, connection } = useLocalSearchParams<{ threadId: string; connection?: string | string[] }>();
  const id = routeId(rawId), slot = routeConnection(connection);
  if (!id || !slot) return <Notice text="This conversation is unavailable." />;
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#f2f5f9' }} edges={['bottom', 'left', 'right']}>
    <ConnectionScope slot={slot} fallback={<Notice text="This conversation is unavailable." />}><Page id={id} /></ConnectionScope>
  </SafeAreaView>;
}
