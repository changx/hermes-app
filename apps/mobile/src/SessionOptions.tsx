import React, { useEffect, useState } from 'react';
import { Alert, Share } from 'react-native';
import { useRouter } from 'expo-router';
import { buildSessionLink } from '../../../packages/client/src/sessionLinks';
import { cacheHitPercent, exactTokens, formatTokens, type ThreadUsage } from '../../../packages/client/src/threadUsage';
import { Notice, channelRoute, labelsRoute, sessionFilesRoute, useApp } from './App';
import { copyWithToast } from './CopyToast';
import { SettingsPage, SettingsRow, SettingsSection, SettingsValueRow } from './SettingsUI';

/**
 * Everything the Session header used to offer, on one native Stack page:
 * labels, Session files, the conversation link, conversation export, archive and the app Settings entry.
 */
export function SessionOptionsScreen({ threadId }: { threadId: string }) {
  const router = useRouter();
  const { client, config, slot } = useApp();
  const [exporting, setExporting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const thread = client?.threads.get(threadId);
  // Token usage is read once when the page opens; the section shows only after a successful read.
  const [usage, setUsage] = useState<ThreadUsage>();
  useEffect(() => {
    if (!client?.supportsThreadUsage) return;
    let live = true;
    client.threadUsage(threadId).then(value => { if (live && value) setUsage(value); }, () => {});
    return () => { live = false; };
  }, [client, threadId]);
  if (!client || !config) return <Notice text="Opening conversation…" />;
  if (!thread || thread.archived) return <Notice text="This conversation is unavailable." />;
  const labels = thread.markers ?? [];
  const exportConversation = async () => {
    setExporting(true);
    try {
      const text = await client.exportThread(threadId);
      await Share.share({ message: text, title: thread.title || 'Conversation' });
    } catch {
      Alert.alert('Could not export this conversation', 'Check the connection and try again.');
    } finally { setExporting(false); }
  };
  // Core archive: the session leaves every list; nothing is deleted.
  const archiveSession = () => Alert.alert('Archive this session?', 'It will no longer be shown on any device.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Archive', style: 'destructive', onPress: () => {
      setArchiving(true);
      void client.archiveThread(threadId).then(
        () => router.dismissTo(channelRoute(slot, thread.project_id)),
        () => { setArchiving(false); Alert.alert('Could not archive this session', 'Check the connection and try again.'); });
    } },
  ]);
  return <SettingsPage>
    <SettingsSection title="This session">
      {client.supportsSessionLabels && <SettingsRow first title="Labels" value={labels.length ? labels.join(', ') : 'None'}
        label={`Edit labels, ${labels.length ? labels.join(', ') : 'none'}`} onPress={() => router.push(labelsRoute(slot, threadId))} />}
      {client.supportsSessionFiles && <SettingsRow first={!client.supportsSessionLabels} title="Files" label="Session files"
        onPress={() => router.push(sessionFilesRoute(slot, threadId))} />}
      <SettingsRow first={!client.supportsSessionLabels && !client.supportsSessionFiles} title="Copy session link" label="Copy session link"
        onPress={() => { void copyWithToast(buildSessionLink(config.baseUrl, threadId)); }} />
      {client.supportsThreadExport && <SettingsRow title={exporting ? 'Exporting…' : 'Export conversation'} label="Export conversation"
        onPress={() => { if (!exporting) void exportConversation(); }} />}
      <SettingsRow title={archiving ? 'Archiving…' : 'Archive session'} label="Archive session"
        onPress={() => { if (!archiving) archiveSession(); }} />
    </SettingsSection>
    {usage && <SettingsSection title="Usage">
      {usage.contextTokens !== null && <SettingsValueRow first title="Context" detail="Latest request, after compaction" value={`${formatTokens(usage.contextTokens)} tokens`}
        label={`Context, ${exactTokens(usage.contextTokens)} tokens in the latest request`} />}
      {usage.cache && <SettingsValueRow first={usage.contextTokens === null} title="Cache hit" detail="Latest request, from the prompt cache" value={`${cacheHitPercent(usage.cache)}%`}
        label={`Cache hit, ${cacheHitPercent(usage.cache)}%: ${exactTokens(usage.cache.readTokens)} of ${exactTokens(usage.cache.promptTokens)} input tokens of the latest request came from the prompt cache`} />}
      <SettingsValueRow first={usage.contextTokens === null && !usage.cache} title="Total" detail="All requests in this session" value={`${formatTokens(usage.totalTokens)} tokens`}
        label={`Total, ${exactTokens(usage.totalTokens)} tokens used by this session`} />
    </SettingsSection>}
    <SettingsSection title="App">
      <SettingsRow first title="Settings" onPress={() => router.push('/settings')} />
    </SettingsSection>
  </SettingsPage>;
}
