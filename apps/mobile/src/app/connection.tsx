import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ConnectionRoute } from '../App';

export default function Connection() {
  return <SafeAreaView style={{ flex: 1 }} edges={['bottom', 'left', 'right']}><ConnectionRoute /></SafeAreaView>;
}
