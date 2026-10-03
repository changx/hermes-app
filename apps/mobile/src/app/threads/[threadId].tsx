import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Notice, ThreadScreen } from '../../App';
import { routeId } from '../../routeId';

export default function Thread() {
  const { threadId: rawId, messageRef } = useLocalSearchParams<{ threadId: string; messageRef?: string | string[] }>();
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
