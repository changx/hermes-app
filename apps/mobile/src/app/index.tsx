import React, { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChannelsScreen, Notice, useApp } from '../App';

export default function Channels() {
  const { ready, config, editing, pendingPairing } = useApp();
  const router = useRouter();
  useEffect(() => { if (ready && (!config || (editing && pendingPairing))) router.replace('/connection'); }, [ready, config, editing, pendingPairing, router]);
  if (!ready || !config || (editing && pendingPairing)) return <Notice text="Opening…" />;
  return <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom', 'left', 'right']}><ChannelsScreen /></SafeAreaView>;
}
