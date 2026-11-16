import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FormKeyboardAvoidingView } from '../../App';
import { GroupsPage } from '../../GroupSettings';

/** Settings > Groups (docs/connection-groups.md). */
export default function Groups() {
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#f2f5f9' }} edges={['bottom', 'left', 'right']}>
    <FormKeyboardAvoidingView><GroupsPage /></FormKeyboardAvoidingView>
  </SafeAreaView>;
}
