import React from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FormKeyboardAvoidingView, Notice, useConnections } from '../../App';
import { GroupPage } from '../../GroupSettings';

/** Settings > Groups > one group (docs/connection-groups.md). */
export default function Group() {
  const { group } = useLocalSearchParams<{ group?: string | string[] }>();
  const { groups } = useConnections();
  if (typeof group !== 'string') return <Notice text="This group is unavailable." />;
  const name = groups.groups.find(item => item.id === group)?.name ?? 'Group';
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#f2f5f9' }} edges={['bottom', 'left', 'right']}>
    <Stack.Screen options={{ title: name }} />
    <FormKeyboardAvoidingView><GroupPage id={group} /></FormKeyboardAvoidingView>
  </SafeAreaView>;
}
