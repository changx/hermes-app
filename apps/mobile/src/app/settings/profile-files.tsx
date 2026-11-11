import React, { useEffect, useState } from 'react';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ConnectionScope, Notice, routeConnection, useApp } from '../../App';
import { ProfileFilesSettings } from '../../ProfileFilesSettings';
import { profileFileSettingsRoute } from '../../settingsRoutes';

function Page({ slot }: { slot: string }) {
  const { client } = useApp();
  const router = useRouter();
  const focused = useIsFocused();
  const [shown, setShown] = useState(0);
  useEffect(() => { if (focused) setShown(n => n + 1); }, [focused]);
  if (!client?.supportsProfileFiles) return <Notice text="Persona & memory are available when this connection is online." />;
  return <ProfileFilesSettings client={client} refresh={shown} onOpen={kind => router.push(profileFileSettingsRoute(slot, kind))} />;
}

export default function ProfileFilesSettingsRoute() {
  const { connection } = useLocalSearchParams<{ connection?: string | string[] }>();
  const slot = routeConnection(connection);
  if (!slot) return <Notice text="This connection is unavailable." />;
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#f2f5f9' }} edges={['bottom', 'left', 'right']}>
    <ConnectionScope slot={slot} fallback={<Notice text="This connection was removed." />}><Page slot={slot} /></ConnectionScope>
  </SafeAreaView>;
}
