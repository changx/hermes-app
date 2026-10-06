import React, { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FormKeyboardAvoidingView, Notice, useConnections } from '../App';
import { AddConnectionForm } from '../ConnectionScreen';

/** First run only: pair the first Hermes. Later connections are added in Settings. */
export default function Welcome() {
  const { ready, connections, addConnection } = useConnections();
  const router = useRouter();
  const paired = ready && connections.length > 0;
  useEffect(() => { if (paired) router.replace('/'); }, [paired, router]);
  if (!ready || paired) return <Notice text="" />;
  return <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom', 'left', 'right']}>
    <FormKeyboardAvoidingView>
      <AddConnectionForm first onAdd={(server, code) => addConnection(server, code)} />
    </FormKeyboardAvoidingView>
  </SafeAreaView>;
}
