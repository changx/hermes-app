import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FormKeyboardAvoidingView } from '../../App';
import { AddConnectionSettings } from '../../SettingsScreens';

export default function AddConnection() {
  return <SafeAreaView style={{ flex: 1 }} edges={['bottom', 'left', 'right']}>
    <FormKeyboardAvoidingView><AddConnectionSettings /></FormKeyboardAvoidingView>
  </SafeAreaView>;
}
