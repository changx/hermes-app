import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Notice, ThreadScreen } from '../../App';
import { routeId } from '../../routeId';

export default function Thread() {
  const { threadId: rawId } = useLocalSearchParams<{ threadId: string }>();
  const id = routeId(rawId);
  if (!id) return <Notice text="This conversation is unavailable." />;
  return <ThreadScreen key={id} threadId={id} />;
}
