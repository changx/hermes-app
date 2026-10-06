import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SettingsHome } from '../../SettingsScreens';

export default function Settings() {
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#f2f5f9' }} edges={['bottom', 'left', 'right']}><SettingsHome /></SafeAreaView>;
}
