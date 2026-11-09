import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ConnectionScope, FormKeyboardAvoidingView, Notice, routeConnection, useApp } from '../../App';
import { VaultSettings } from '../../VaultSettings';

function Page() {
  const { client } = useApp();
  if (!client?.supportsVault) return <Notice text="Passwords & Logins are available when this connection is online." />;
  return <VaultSettings client={client} />;
}

export default function VaultSettingsRoute() {
  const { connection } = useLocalSearchParams<{ connection?: string | string[] }>();
  const slot = routeConnection(connection);
  if (!slot) return <Notice text="This connection is unavailable." />;
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#f2f5f9' }} edges={['bottom', 'left', 'right']}>
    <ConnectionScope slot={slot} fallback={<Notice text="This connection was removed." />}>
      <FormKeyboardAvoidingView><Page /></FormKeyboardAvoidingView>
    </ConnectionScope>
  </SafeAreaView>;
}
