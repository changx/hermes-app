import React from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { workspacePath } from '../../../../../../packages/client/src/index';
import { FormKeyboardAvoidingView, Notice, useApp } from '../../../App';
import { ChannelFilesScreen } from '../../../ChannelFilesScreen';
import { routeId } from '../../../routeId';

export default function ChannelFiles() {
  const { channelId: rawId, path: rawPath } = useLocalSearchParams<{ channelId: string; path?: string | string[] }>();
  const { client, config } = useApp();
  const router = useRouter();
  const id = routeId(rawId);
  let directory: string;
  try { if (rawPath !== undefined && typeof rawPath !== 'string') throw new Error('Invalid folder'); directory = workspacePath(rawPath ?? '', true); }
  catch { return <Notice text="This folder is unavailable." />; }
  if (!id) return <Notice text="This channel is unavailable." />;
  if (!client || !config) return null;
  return <SafeAreaView style={{ flex: 1 }} edges={['bottom', 'left', 'right']}>
    <Stack.Screen options={{ title: directory ? directory.split('/').at(-1) : 'Files' }} />
    <FormKeyboardAvoidingView><ChannelFilesScreen key={config.id + ':' + id + ':' + directory} client={client} channelId={id} directory={directory}
      onDirectory={path => router.push({ pathname: '/channels/[channelId]/files', params: { channelId: id, path } })}
      onAgents={() => router.push({ pathname: '/channels/[channelId]/agents', params: { channelId: id } })} /></FormKeyboardAvoidingView>
  </SafeAreaView>;
}
