import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ConnectionScope, Notice, channelRoute, routeConnection, useApp } from '../../App';
import { Text } from '../../FontSize';
import { automationStatus, automationTiming, scheduleLabel } from '../../automationText';
import { routeId } from '../../routeId';
import { useSessionNavigation } from '../../sessionNavigation';
import type { Automation, AutomationThread } from '../../../../../packages/client/src/automations';

/** One automation: what it does, where it delivers, and the Threads it produced. */
function Detail({ automationId }: { automationId: string }) {
  const { client, slot } = useApp();
  const navigation = useSessionNavigation();
  const router = useRouter();
  const [job, setJob] = useState<Automation | null>(null), [threads, setThreads] = useState<AutomationThread[]>([]);
  const [next, setNext] = useState<number | null>(null), [error, setError] = useState(''), [missing, setMissing] = useState(false);
  const [more, setMore] = useState(false), [showPrompt, setShowPrompt] = useState(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    if (!client?.supportsAutomations) return;
    const version = ++generation.current;
    try {
      const page = await client.automation(automationId);
      if (version !== generation.current) return;
      setJob(page.automation); setThreads([...page.threads]); setNext(page.nextBefore); setError(''); setMissing(false);
    } catch (failure) {
      if (version !== generation.current) return;
      if ((failure as { status?: number }).status === 404) setMissing(true);
      else setError('Could not load this automation. Pull down to try again.');
    }
  }, [client, automationId]);
  // Reload on return: reading a Thread clears its unread mark.
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const loadMore = async () => {
    if (!client || next === null || more) return;
    setMore(true);
    try {
      const page = await client.automation(automationId, next);
      setThreads(old => [...old, ...page.threads.filter(t => !old.some(o => o.id === t.id))]); setNext(page.nextBefore);
    } catch { setError('Could not load more conversations.'); }
    finally { setMore(false); }
  };
  if (!client) return <Notice text="Opening…" />;
  if (!client.supportsAutomations) return <Notice text="Automations are not available on this connection yet." />;
  if (missing) return <Notice text="This automation no longer exists." />;
  if (!job) return error ? <Notice text={error} /> : <ActivityIndicator style={s.spinner} />;
  const channelName = (id: string) => client.channels.get(id)?.name;
  const status = automationStatus(job);
  return <FlatList data={threads} keyExtractor={t => t.id} contentContainerStyle={s.list}
    refreshing={false} onRefresh={() => void load()}
    ListHeaderComponent={<View style={s.header}>
      <Stack.Screen options={{ title: job.name }} />
      <Text style={s.title}>{job.name}</Text>
      <Text style={[s.status, job.running && s.running, job.failed && !job.running && s.failed]}>{status}</Text>
      <Text style={s.line}>{[scheduleLabel(job.schedule), automationTiming(job)].join(' · ')}</Text>
      {job.targets.map(target => {
        const name = channelName(target.channelId);
        const text = `${target.mode === 'new' ? 'New conversation each run in' : 'Adds each run to one conversation in'} ${name ?? 'a channel that is no longer available'}`;
        return <Pressable key={target.channelId + (target.threadId ?? '')} accessibilityRole={name ? 'link' : 'text'} disabled={!name}
          onPress={() => router.push(channelRoute(slot, target.channelId))}>
          <Text style={[s.line, !!name && s.link]}>{text}</Text>
        </Pressable>;
      })}
      {!job.targets.length && <Text style={s.line}>Results are not delivered to a channel.</Text>}
      {!!job.prompt && <Pressable accessibilityRole="button" accessibilityState={{ expanded: showPrompt }} onPress={() => setShowPrompt(v => !v)}>
        <Text style={s.link}>{showPrompt ? 'Hide instructions' : 'Show instructions'}</Text>
      </Pressable>}
      {showPrompt && !!job.prompt && <Text selectable style={s.prompt}>{job.prompt}</Text>}
      {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      <Text style={s.section}>Conversations</Text>
    </View>}
    renderItem={({ item }) => <Pressable accessibilityRole="button" onPress={() => navigation.thread(item.id)}
      accessibilityLabel={[item.title, channelName(item.channelId), item.completedUnread ? 'Completed, unread' : undefined].filter(Boolean).join(', ')}
      style={({ pressed }) => [s.card, pressed && s.pressed]}>
      <View style={s.fill}>
        <Text numberOfLines={2} style={s.heading}>{item.title}</Text>
        <Text numberOfLines={1} style={s.line}>{[channelName(item.channelId), item.runs > 1 ? `${item.runs} results` : undefined].filter(Boolean).join(' · ')}</Text>
      </View>
      {item.completedUnread && <View style={s.unreadDot} />}
    </Pressable>}
    ListFooterComponent={next !== null ? <Pressable accessibilityRole="button" disabled={more} onPress={() => void loadMore()} style={s.more}>
      <Text style={s.link}>{more ? 'Loading…' : 'Show more'}</Text></Pressable> : null}
    ListEmptyComponent={<Text style={s.empty}>No conversations yet. They appear here after a run delivers its result.</Text>} />;
}

export default function AutomationPage() {
  const { automationId: raw, connection } = useLocalSearchParams<{ automationId: string; connection?: string | string[] }>();
  const automationId = routeId(raw), slot = routeConnection(connection);
  if (!automationId || !slot) return <Notice text="This automation is unavailable." />;
  return <SafeAreaView style={s.fill} edges={['bottom', 'left', 'right']}>
    <ConnectionScope slot={slot} fallback={<Notice text="This automation is unavailable." />}><Detail automationId={automationId} /></ConnectionScope>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  fill: { flex: 1 }, list: { paddingHorizontal: 12, paddingBottom: 24 }, spinner: { marginTop: 24 },
  header: { paddingTop: 16, gap: 6 },
  title: { fontSize: 22, fontWeight: '700', color: '#14283e' },
  status: { fontSize: 14, fontWeight: '600', color: '#42566f' }, running: { color: '#237a35' }, failed: { color: '#9d1b32' },
  line: { fontSize: 14, color: '#607187' }, link: { fontSize: 14, color: '#2b4e81', fontWeight: '600' },
  prompt: { fontSize: 14, color: '#172a40', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 9, padding: 10 },
  section: { fontSize: 13, fontWeight: '600', color: '#65758b', marginTop: 16, marginBottom: 6 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 14, marginBottom: 8 },
  pressed: { backgroundColor: '#eef3fa' },
  heading: { fontSize: 16, fontWeight: '600', color: '#172a40', marginBottom: 2 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4DA3FF' },
  more: { alignItems: 'center', paddingVertical: 12 },
  error: { color: '#9d1b32', backgroundColor: '#fff0f2', padding: 10, borderRadius: 8 },
  empty: { color: '#65758b', textAlign: 'center', padding: 24 },
});
