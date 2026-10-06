import React from 'react';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FormKeyboardAvoidingView, Notice, useConnections } from '../App';
import { ConnectionManager } from '../ConnectionScreen';
import { MAX_CONNECTIONS } from '../connectionSlots';

export default function Connection() {
  const { ready, listError, connections, addConnection, removeConnection } = useConnections();
  const router = useRouter();
  if (!ready) return <Notice text="" />;
  const done = () => { if (router.canGoBack()) router.back(); else router.replace('/'); };
  return <SafeAreaView style={{ flex: 1 }} edges={['bottom', 'left', 'right']}>
    <FormKeyboardAvoidingView>
      <ConnectionManager ready={ready} listError={listError} connections={connections} max={MAX_CONNECTIONS}
        onAdd={async (server, code) => {
          const first = !connections.length;
          await addConnection(server, code);
          // The first connection opens the Project list; later ones stay here to show progress.
          if (first) router.replace('/');
        }}
        onRemove={removeConnection} onDone={done} />
    </FormKeyboardAvoidingView>
  </SafeAreaView>;
}
