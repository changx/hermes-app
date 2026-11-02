import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ConnectionScope, Notice, ThreadScreen, routeConnection, useConnections } from '../../App';
import { sessionServer } from '../../../../../packages/client/src/sessionLinks';
import { routeId } from '../../routeId';
import { PageErrorBoundary } from '../../PageErrorBoundary';

export default function Thread() {
  const { threadId: rawId, messageRef, server, connection } = useLocalSearchParams<{ threadId: string; messageRef?: string | string[]; server?: string | string[]; connection?: string | string[] }>();
  const { ready, connections } = useConnections();
  let slot: string | null;
  if (server !== undefined) {
    // A system link names its server: open it with the matching saved connection.
    if (!ready) return <Notice text="Opening conversation…" />;
    if (typeof server !== 'string' || !sessionServer(server)) return <Notice text="This conversation link is invalid." />;
    slot = connections.find(c => c.config && sessionServer(c.config.baseUrl) === sessionServer(server))?.slot ?? null;
    if (!slot) return <Notice text="This conversation belongs to a Hermes that is not connected on this device. Add that connection to open it." />;
  } else slot = routeConnection(connection);
  const id = routeId(rawId);
  const targetRef = typeof messageRef === 'string' && /^[1-9][0-9]*$/.test(messageRef) && Number.isSafeInteger(Number(messageRef)) ? Number(messageRef) : undefined;
  if (messageRef !== undefined && targetRef === undefined) return <Notice text="This message is unavailable." />;
  if (!id || !slot) return <Notice text="This conversation is unavailable." />;
  // The native Stack owns the header; ChatTimeline's keyboard offsets assume
  // its layout already stops above the bottom safe area.
  return <SafeAreaView style={{ flex: 1 }} edges={['bottom', 'left', 'right']}>
    <ConnectionScope slot={slot} fallback={<Notice text="This conversation is unavailable." />}>
      <PageErrorBoundary><ThreadScreen key={targetRef === undefined ? id : id + ':' + targetRef} threadId={id} targetRef={targetRef} /></PageErrorBoundary>
    </ConnectionScope>
  </SafeAreaView>;
}
