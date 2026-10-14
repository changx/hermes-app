import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppIconPage } from '../../SettingsScreens';

export default function AppIcon() {
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#f2f5f9' }} edges={['bottom', 'left', 'right']}><AppIconPage /></SafeAreaView>;
}
