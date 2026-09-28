import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SettingsRoute } from '../App';

export default function Settings() {
  return <SafeAreaView style={{ flex: 1 }} edges={['bottom', 'left', 'right']}><SettingsRoute /></SafeAreaView>;
}
