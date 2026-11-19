import React, { useEffect, useState } from 'react';
import { Alert, Share } from 'react-native';
import { useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { buildSessionLink } from '../../../packages/client/src/sessionLinks';
import { threadModelSwitchCommand, type AgentModelSettings, type ThreadModelChoice } from '../../../packages/client/src/index';
import { cacheHitPercent, exactTokens, formatTokens, type ThreadUsage } from '../../../packages/client/src/threadUsage';
import { Notice, channelRoute, labelsRoute, sessionFilesRoute, useApp } from './App';
import { copyWithToast } from './CopyToast';
import { SettingsPage, SettingsRow, SettingsSection, SettingsValueRow } from './SettingsUI';
import { ThreadModelPicker } from './ThreadModelPicker';
import { newSend } from './send';
import { useSessionNavigation } from './sessionNavigation';
import { runningFirst } from '../../../packages/client/src/todo';

/**
 * Everything the Session header used to offer, on one native Stack page:
 * labels, Session files, the conversation link, conversation export, archive and the app Settings entry.
 */
export function SessionOptionsScreen({ threadId }: { threadId: string }) {
  const router = useRouter();
  const { client, config, slot, outboxRef } = useApp();
  const [exporting, setExporting] = useState(false);
  // Switch model: the list loads when the picker opens; a choice sends native `/model … --session`.
  const [picking, setPicking] = useState(false);
  const [models, setModels] = useState<AgentModelSettings | null>(null), [modelsFailed, setModelsFailed] = useState(false), [modelsLoad, setModelsLoad] = useState(0);
  useEffect(() => {
    if (!picking || models || !client) return;
    const controller = new AbortController();
    setModelsFailed(false);
    client.getModelSettings(controller.signal).then(value => { if (!controller.signal.aborted) setModels(value); },
      () => { if (!controller.signal.aborted) setModelsFailed(true); });
    return () => controller.abort();
  }, [client, picking, models, modelsLoad]);
  const [archiving, setArchiving] = useState(false);
  const navigation = useSessionNavigation();
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
  // Side chats (docs/side-chat.md): the phone opens them from here or from the anchor mark, never from a list.
  const source = thread.side_of ? client.threads.get(thread.side_of.thread_id) : undefined;
  const sides = thread.side_of ? [] : [...client.threads.values()]
    .filter(t => t.side_of?.thread_id === threadId && t.id !== threadId && !t.archived)
    .map(t => ({ id: t.id, title: t.title, running: t.running === true, completed_unread: t.completed_unread === true, lastMessageAt: t.last_message_at }))
    .sort(runningFirst);
  const exportConversation = async () => {
    setExporting(true);
    try {
      const text = await client.exportThread(threadId);
      await Share.share({ message: text, title: thread.title || 'Conversation' });
    } catch {
      Alert.alert('Could not export this conversation', 'Check the connection and try again.');
    } finally { setExporting(false); }
  };
  // The command goes through the outbox like a typed message (same ID on every retry).
  // Hermes switches this session only and answers in the timeline, so the page returns there.
  const switchModel = (choice: ThreadModelChoice | null) => {
    const box = outboxRef.current;
    setPicking(false);
    if (!models || !box || box.storage.connectionId !== config.id) return;
    void box.enqueue(newSend(config, threadId, threadModelSwitchCommand(models, choice), 'mob_' + Crypto.randomUUID(), [])).then(
      () => { if (router.canGoBack()) router.back(); },
      () => Alert.alert('Could not switch the model', 'Check the connection and try again.'));
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
      {client.supportsThreadModel && <SettingsRow title="Switch model" label="Switch model" onPress={() => setPicking(true)} />}
      {client.supportsThreadExport && <SettingsRow title={exporting ? 'Exporting…' : 'Export conversation'} label="Export conversation"
        onPress={() => { if (!exporting) void exportConversation(); }} />}
      <SettingsRow title={archiving ? 'Archiving…' : 'Archive session'} label="Archive session"
        onPress={() => { if (!archiving) archiveSession(); }} />
    </SettingsSection>
    {source && !source.archived && <SettingsSection title="Side chat">
      <SettingsRow first title="Source session" value={source.title} label={`Open the source session, ${source.title}`} onPress={() => navigation.thread(source.id)} />
    </SettingsSection>}
    {sides.length > 0 && <SettingsSection title="Side chats">
      {sides.map((side, index) => <SettingsRow key={side.id} first={index === 0} title={side.title}
        value={[side.running && 'Running', side.completed_unread && 'Unread'].filter(Boolean).join(' · ') || undefined}
        label={[side.title, side.running && 'running', side.completed_unread && 'unread result'].filter(Boolean).join(', ')} onPress={() => navigation.thread(side.id)} />)}
    </SettingsSection>}
    {usage && <SettingsSection title="Usage">
      {usage.contextTokens !== null && <SettingsValueRow first title="Context" detail="Latest request, after compaction" value={`${formatTokens(usage.contextTokens)} tokens`}
        label={`Context, ${exactTokens(usage.contextTokens)} tokens in the latest request`} />}
      {usage.cache && <SettingsValueRow first={usage.contextTokens === null} title="Cache hit" detail="First request of the latest turn" value={`${cacheHitPercent(usage.cache)}%`}
        label={`Cache hit, ${cacheHitPercent(usage.cache)}%: ${exactTokens(usage.cache.readTokens)} of ${exactTokens(usage.cache.promptTokens)} input tokens of the latest turn's first request came from the prompt cache`} />}
      <SettingsValueRow first={usage.contextTokens === null && !usage.cache} title="Total" detail="All requests in this session" value={`${formatTokens(usage.totalTokens)} tokens`}
        label={`Total, ${exactTokens(usage.totalTokens)} tokens used by this session`} />
    </SettingsSection>}
    <SettingsSection title="App">
      <SettingsRow first title="Settings" onPress={() => router.push('/settings')} />
    </SettingsSection>
    {client.supportsThreadModel && <ThreadModelPicker visible={picking} settings={models} failed={modelsFailed} onClose={() => setPicking(false)}
      onPick={switchModel} onRetry={() => { setModels(null); setModelsLoad(n => n + 1); }} />}
  </SettingsPage>;
}
