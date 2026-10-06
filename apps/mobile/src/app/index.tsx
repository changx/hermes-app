import React, { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet, View } from 'react-native';
import { HeaderActions, Notice, channelRoute, useConnections } from '../App';
import { Text } from '../FontSize';
import { ProjectList } from '../ProjectList';

/** Home: Projects from every saved connection in one flat list. */
export default function Projects() {
  const { ready, connections, revision, listError } = useConnections();
  const router = useRouter();
  const empty = ready && !listError && !connections.length;
  useEffect(() => { if (empty) router.replace('/welcome'); }, [empty, router]);
  if (!ready || empty) return <Notice text="" />;
  return <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom', 'left', 'right']}>
    <View style={styles.header}><View style={{ flex: 1 }}><Text style={styles.brand}>Hermes App</Text></View>
      <HeaderActions onSettings={() => router.push('/settings')} />
    </View>
    {!!listError && <Text accessibilityRole="alert" style={styles.error}>{listError}</Text>}
    <ProjectList connections={connections} revision={revision}
      onProject={(slot, id) => router.push(channelRoute(slot, id))}
      onNewChannel={() => router.push('/new-channel')}
      onConnections={() => router.push('/settings')} />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  header: { paddingLeft: 16, paddingRight: 8, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 6, borderBottomWidth: 1, borderColor: '#e2e8f0' },
  brand: { fontSize: 19, fontWeight: '700', color: '#14283e' },
  error: { color: '#9d1b32', backgroundColor: '#fff0f2', padding: 10 },
});
