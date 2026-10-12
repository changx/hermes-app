import React, { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useConnections } from '../../connections';

/**
 * Bottom tabs, left to right: Recents, Channels, Automations. Each tab is a
 * screen of this native tab bar; Threads, channel pages and settings are
 * pushed on the root Stack above it, so the tab bar hides there and returning
 * restores the tab with its scroll position.
 */
export default function TabsLayout() {
  const { ready, connections, listError } = useConnections();
  const router = useRouter();
  const empty = ready && !listError && !connections.length;
  useEffect(() => { if (empty) router.replace('/welcome'); }, [empty, router]);
  return <NativeTabs tintColor="#2960ad">
    <NativeTabs.Trigger name="index">
      <NativeTabs.Trigger.Label>Recents</NativeTabs.Trigger.Label>
      <NativeTabs.Trigger.Icon sf={{ default: 'clock', selected: 'clock.fill' }} md="schedule" />
    </NativeTabs.Trigger>
    <NativeTabs.Trigger name="channels">
      <NativeTabs.Trigger.Label>Channels</NativeTabs.Trigger.Label>
      <NativeTabs.Trigger.Icon sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }} md="forum" />
    </NativeTabs.Trigger>
    <NativeTabs.Trigger name="automations">
      <NativeTabs.Trigger.Label>Automations</NativeTabs.Trigger.Label>
      <NativeTabs.Trigger.Icon sf={{ default: 'gearshape.2', selected: 'gearshape.2.fill' }} md="autorenew" />
    </NativeTabs.Trigger>
  </NativeTabs>;
}
