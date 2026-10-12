import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ConnectionScope, Notice, channelRoute, routeConnection, useApp } from '../../App';
import { Text, TextInput } from '../../FontSize';
import { runStarted } from '../../automationRows';
import { automationStatus, automationTiming, scheduleLabel } from '../../automationText';
import { routeId } from '../../routeId';
import { useSessionNavigation } from '../../sessionNavigation';
import type { Automation, AutomationThread } from '../../../../../packages/client/src/automations';

const START_WATCH_MS = 120_000, START_POLL_MS = 4_000;

/** One automation: what it does, where it delivers, the Threads it produced, and its controls. */
function Detail({ automationId }: { automationId: string }) {
  const { client, slot } = useApp();
  const navigation = useSessionNavigation();
  const router = useRouter();
  const [job, setJob] = useState<Automation | null>(null), [threads, setThreads] = useState<AutomationThread[]>([]);
  const [next, setNext] = useState<number | null>(null), [error, setError] = useState(''), [missing, setMissing] = useState(false);
  const [more, setMore] = useState(false), [showPrompt, setShowPrompt] = useState(false);
  const [acting, setActing] = useState<string | null>(null), [scheduleOpen, setScheduleOpen] = useState(false);
  // After Run: the job state before the run, until the job reports the run (or two minutes pass).
  const [starting, setStarting] = useState<{ before: Automation; since: number } | null>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    if (!client?.supportsAutomations) return;
    const version = ++generation.current;
    try {
      const page = await client.automation(automationId);
      if (version !== generation.current) return;
      setJob(page.automation); setThreads([...page.threads]); setNext(page.nextBefore); setError(''); setMissing(false);
      setStarting(old => old && (runStarted(old.before, page.automation) || Date.now() - old.since > START_WATCH_MS) ? null : old);
    } catch (failure) {
      if (version !== generation.current) return;
      if ((failure as { status?: number }).status === 404) setMissing(true);
      else setError('Could not load this automation. Pull down to try again.');
    }
  }, [client, automationId]);
  // Reload on return: reading a Thread clears its unread mark.
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  // Run takes effect at the next scheduler tick (up to a minute): check until the run shows.
  useEffect(() => {
    if (!starting) return;
    const timer = setInterval(() => void load(), START_POLL_MS);
    return () => clearInterval(timer);
  }, [starting, load]);
  const act = async (name: string, work: () => Promise<Automation>, failure: string) => {
    if (acting) return;
    setActing(name); setError('');
    try { setJob(await work()); return true; }
    catch (problem) {
      const status = (problem as { status?: number }).status;
      setError(status === 403 ? 'This automation cannot be changed from this app.' : status === 404 ? 'This automation no longer exists.' : failure);
      return false;
    } finally { setActing(null); }
  };
  const run = async () => {
    if (!client || !job) return;
    const before = job;
    if (await act('run', () => client.automationControl(automationId, 'run'), 'Could not start the run. Try again.'))
      setStarting({ before, since: Date.now() });
  };
  const editInConversation = async () => {
    if (!client || acting) return;
    setActing('editor'); setError('');
    try {
      const thread = await client.automationEditor(automationId);
      await client.getThread(thread.id);  // the conversation page needs its channel
      navigation.thread(thread.id);
    } catch { setError('Could not open the settings conversation. Try again.'); }
    finally { setActing(null); }
  };
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
  const status = starting ? 'Starting…' : automationStatus(job);
  const can = (control: string) => client.supportsAutomationControls && job.controls.includes(control as never);
  const editable = job.controls.length > 0;
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
      {editable && (client.supportsAutomationControls || client.supportsAutomationEditors) && <View style={s.actions}>
        {can('pause') && <Action label="Pause" busy={acting === 'pause'} onPress={() => void act('pause', () => client.automationControl(automationId, 'pause'), 'Could not pause. Try again.')} />}
        {can('resume') && <Action label="Resume" busy={acting === 'resume'} onPress={() => void act('resume', () => client.automationControl(automationId, 'resume'), 'Could not resume. Try again.')} />}
        {can('run') && <Action label="Run now" busy={acting === 'run' || !!starting} onPress={() => void run()} />}
        {can('schedule') && <Action label="Change schedule" busy={acting === 'schedule'} onPress={() => setScheduleOpen(true)} />}
        {client.supportsAutomationEditors && <Action label="Edit in conversation" busy={acting === 'editor'} onPress={() => void editInConversation()} />}
      </View>}
      {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      <ScheduleSheet visible={scheduleOpen} current={job.schedule} onClose={() => setScheduleOpen(false)}
        onSave={async text => {
          const saved = await act('schedule', () => client.setAutomationSchedule(automationId, text),
            'This schedule was not understood. Try "every day at 9am", "every 2h" or "0 9 * * 1-5".');
          if (saved) setScheduleOpen(false);
        }} />
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

function Action({ label, busy, onPress }: { label: string; busy: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={onPress}
    style={({ pressed }) => [s.action, pressed && s.pressed, busy && s.busy]}>
    <Text style={s.actionText}>{label}</Text>
  </Pressable>;
}

/** Edit the schedule in the same words the agent understands. */
function ScheduleSheet({ visible, current, onClose, onSave }: { visible: boolean; current: string; onClose: () => void; onSave: (text: string) => Promise<void> }) {
  const [text, setText] = useState(current), [saving, setSaving] = useState(false);
  useEffect(() => { if (visible) setText(current); }, [visible, current]);
  const save = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    try { await onSave(text.trim()); } finally { setSaving(false); }
  };
  return <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
    <View style={s.sheet}>
      <View style={s.sheetHeader}>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={onClose}><Text style={s.link}>Cancel</Text></Pressable>
        <Text accessibilityRole="header" style={s.sheetTitle}>Schedule</Text>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving || !text.trim() }} disabled={saving || !text.trim()} hitSlop={8} onPress={() => void save()}>
          <Text style={[s.link, (saving || !text.trim()) && s.busy]}>{saving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </View>
      <TextInput accessibilityLabel="Schedule" value={text} onChangeText={setText} autoFocus autoCorrect={false} autoCapitalize="none"
        returnKeyType="done" onSubmitEditing={() => void save()} style={s.input} />
      <Text style={s.hint}>Examples: every day at 9am · weekdays at 8:30am · every 2h · 0 9 * * 1-5</Text>
    </View>
  </Modal>;
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
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  action: { borderWidth: 1, borderColor: '#bcd0ea', backgroundColor: '#fff', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 },
  actionText: { fontSize: 14, fontWeight: '600', color: '#2b4e81' }, busy: { opacity: 0.5 },
  sheet: { flex: 1, backgroundColor: '#f8fafc', padding: 16, gap: 12 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: '#14283e' },
  input: { fontSize: 17, color: '#172a40', backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  hint: { fontSize: 13, color: '#607187' },
  error: { color: '#9d1b32', backgroundColor: '#fff0f2', padding: 10, borderRadius: 8 },
  empty: { color: '#65758b', textAlign: 'center', padding: 24 },
});
