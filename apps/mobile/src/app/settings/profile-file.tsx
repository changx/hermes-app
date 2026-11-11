import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ConnectionScope, FormKeyboardAvoidingView, Notice, routeConnection, useApp } from '../../App';
import { ProfileFileEditor } from '../../ProfileFilesSettings';
import { PROFILE_FILE_KINDS, type ProfileFileKind } from '../../../../../packages/client/src/profileFiles';

function Page({ kind }: { kind: ProfileFileKind }) {
  const { client } = useApp();
  if (!client?.supportsProfileFiles) return <Notice text="Persona & memory are available when this connection is online." />;
  return <ProfileFileEditor client={client} kind={kind} />;
}

export default function ProfileFileSettingsRoute() {
  const { connection, file } = useLocalSearchParams<{ connection?: string | string[]; file?: string | string[] }>();
  const slot = routeConnection(connection);
  const kind = PROFILE_FILE_KINDS.find(value => value === file);
  if (!slot || !kind) return <Notice text="This file is unavailable." />;
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#f2f5f9' }} edges={['bottom', 'left', 'right']}>
    <ConnectionScope slot={slot} fallback={<Notice text="This connection was removed." />}>
      <FormKeyboardAvoidingView><Page kind={kind} /></FormKeyboardAvoidingView>
    </ConnectionScope>
  </SafeAreaView>;
}
