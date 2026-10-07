import React from 'react';
import { useRouter } from 'expo-router';
import { buildSessionLink } from '../../../packages/client/src/sessionLinks';
import { Notice, labelsRoute, useApp } from './App';
import { copyWithToast } from './CopyToast';
import { SettingsPage, SettingsRow, SettingsSection } from './SettingsUI';

/**
 * Everything the Session header used to offer, on one native Stack page:
 * labels, the conversation link and the app Settings entry.
 */
export function SessionOptionsScreen({ threadId }: { threadId: string }) {
  const router = useRouter();
  const { client, config, slot } = useApp();
  const thread = client?.threads.get(threadId);
  if (!client || !config) return <Notice text="Opening conversation…" />;
  if (!thread || thread.archived) return <Notice text="This conversation is unavailable." />;
  const labels = thread.markers ?? [];
  return <SettingsPage>
    <SettingsSection title="This session">
      {client.supportsSessionLabels && <SettingsRow first title="Labels" value={labels.length ? labels.join(', ') : 'None'}
        label={`Edit labels, ${labels.length ? labels.join(', ') : 'none'}`} onPress={() => router.push(labelsRoute(slot, threadId))} />}
      <SettingsRow first={!client.supportsSessionLabels} title="Copy session link" label="Copy session link"
        onPress={() => { void copyWithToast(buildSessionLink(config.baseUrl, threadId)); }} />
    </SettingsSection>
    <SettingsSection title="App">
      <SettingsRow first title="Settings" onPress={() => router.push('/settings')} />
    </SettingsSection>
  </SettingsPage>;
}
