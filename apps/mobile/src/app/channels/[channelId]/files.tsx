import React from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { workspacePath } from '../../../../../../packages/client/src/index';
import { ConnectionScope, FormKeyboardAvoidingView, Notice, channelRoute, routeConnection, useApp } from '../../../App';
import { ChannelFilesScreen } from '../../../ChannelFilesScreen';
import { routeId } from '../../../routeId';

function Page({ id, directory }: { id: string; directory: string }) {
  const { client, config, slot } = useApp();
  const router = useRouter();
  if (!client || !config) return null;
  return <>
    <Stack.Screen options={{ title: directory ? directory.split('/').at(-1) : 'Files' }} />
    <FormKeyboardAvoidingView><ChannelFilesScreen key={config.id + ':' + id + ':' + directory} client={client} channelId={id} directory={directory}
      onDirectory={path => router.push(channelRoute(slot, id, '/files', { path }))}
      onAgents={() => router.push(channelRoute(slot, id, '/agents'))} /></FormKeyboardAvoidingView>
  </>;
}

export default function ChannelFiles() {
  const { channelId: rawId, path: rawPath, connection } = useLocalSearchParams<{ channelId: string; path?: string | string[]; connection?: string | string[] }>();
  const id = routeId(rawId), slot = routeConnection(connection);
  let directory: string;
  try { if (rawPath !== undefined && typeof rawPath !== 'string') throw new Error('Invalid folder'); directory = workspacePath(rawPath ?? '', true); }
  catch { return <Notice text="This folder is unavailable." />; }
  if (!id || !slot) return <Notice text="This channel is unavailable." />;
  return <SafeAreaView style={{ flex: 1 }} edges={['bottom', 'left', 'right']}>
    <ConnectionScope slot={slot} fallback={<Notice text="This channel is unavailable." />}><Page id={id} directory={directory} /></ConnectionScope>
  </SafeAreaView>;
}
