import React from 'react';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native';
import { Notice, channelRoute, useConnections } from '../../App';
import { Text } from '../../FontSize';
import { ProjectList } from '../../ProjectList';
import { TabHeader } from '../../TabHeader';

/** Channels tab: channels from every saved connection in one flat list. */
export default function Channels() {
  const { ready, connections, revision, listError } = useConnections();
  const router = useRouter();
  if (!ready) return <Notice text="" />;
  return <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
    <TabHeader title="Channels" />
    {!!listError && <Text accessibilityRole="alert" style={styles.error}>{listError}</Text>}
    <ProjectList connections={connections} revision={revision}
      onProject={(slot, id) => router.push(channelRoute(slot, id))}
      onNewChannel={() => router.push('/new-channel')}
      onConnections={() => router.push('/settings')} />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  error: { color: '#9d1b32', backgroundColor: '#fff0f2', padding: 10 },
});
