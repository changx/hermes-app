import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Notice, ThreadScreen } from '../../App';
import { routeId } from '../../routeId';

export default function Thread() {
  const { threadId: rawId } = useLocalSearchParams<{ threadId: string }>();
  const id = routeId(rawId);
  if (!id) return <Notice text="This conversation is unavailable." />;
  // The native Stack owns the header; ChatTimeline's keyboard offsets assume
  // its layout already stops above the bottom safe area.
  return <SafeAreaView style={{ flex: 1 }} edges={['bottom', 'left', 'right']}>
    <ThreadScreen key={id} threadId={id} />
  </SafeAreaView>;
}
