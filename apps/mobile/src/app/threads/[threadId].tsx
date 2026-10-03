import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Notice, ThreadScreen, useApp } from '../../App';
import { sessionServer } from '../../../../../packages/client/src/sessionLinks';
import { routeId } from '../../routeId';

export default function Thread() {
  const { threadId: rawId, messageRef, server } = useLocalSearchParams<{ threadId: string; messageRef?: string | string[]; server?: string | string[] }>();
  const { ready, config } = useApp();
  if (server !== undefined) {
    if (!ready) return <Notice text="Opening conversation…" />;
    if (typeof server !== 'string' || !sessionServer(server)) return <Notice text="This conversation link is invalid." />;
    if (!config || sessionServer(config.baseUrl) !== sessionServer(server)) return <Notice text="This conversation belongs to another Hermes. Open it on a device paired with that Hermes." />;
  }
  const id = routeId(rawId);
  const targetRef = typeof messageRef === 'string' && /^[1-9][0-9]*$/.test(messageRef) && Number.isSafeInteger(Number(messageRef)) ? Number(messageRef) : undefined;
  if (messageRef !== undefined && targetRef === undefined) return <Notice text="This message is unavailable." />;
  if (!id) return <Notice text="This conversation is unavailable." />;
  // The native Stack owns the header; ChatTimeline's keyboard offsets assume
  // its layout already stops above the bottom safe area.
  return <SafeAreaView style={{ flex: 1 }} edges={['bottom', 'left', 'right']}>
    <ThreadScreen key={targetRef === undefined ? id : id + ':' + targetRef} threadId={id} targetRef={targetRef} />
  </SafeAreaView>;
}
