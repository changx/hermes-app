import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FontSizePage } from '../../SettingsScreens';

export default function FontSize() {
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#f2f5f9' }} edges={['bottom', 'left', 'right']}><FontSizePage /></SafeAreaView>;
}
