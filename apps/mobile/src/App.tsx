import React, { useEffect, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { HermesClient } from '../../../packages/client/src/index';
import type { Interaction, ThreadSummary } from '../../../packages/client/src/index';
import { nativeTransport } from './transport';
import { DEFAULT_BASE, connection, editConnection, newSend } from './send';
import type { Connection, SendRecord } from './send';
import { MobileOutbox, OutboxStore, type NetworkState } from './outbox';
import { ChatTimeline, type ChatTimelineHandle } from './ChatTimeline';
import { ChannelScreens } from './ChannelScreens';
import { locateLatest, olderStart, projectTimeline, windowStart, type TimelinePosition } from './timeline';

const CONFIG_KEY = 'hermes-app-connection-v1';
const messageError = (e: unknown) => e instanceof Error ? e.message : '操作失败';
const networkName: Record<NetworkState, string> = { connecting: '连接中', syncing: '补齐中', online: '在线', retrying: '等待网络', suspended: '后台已暂停', blocked: '连接受阻' };

function Button({ title, onPress, disabled = false, secondary = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, secondary && styles.secondary, disabled && styles.disabled]}><Text style={[styles.buttonText, secondary && styles.secondaryText]}>{title}</Text></Pressable>;
}
function Screen() {
  const [config, setConfig] = useState<Connection | null>(null);
  const [ready, setReady] = useState(false), [editing, setEditing] = useState(false);
  const [base, setBase] = useState(DEFAULT_BASE), [token, setToken] = useState('');
  const [client, setClient] = useState<HermesClient | null>(null);
  const [revision, setRevision] = useState(0), [busy, setBusy] = useState(false);
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [loading, setLoading] = useState(false), [status, setStatus] = useState('未连接'), [error, setError] = useState('');
  const [channelId, setChannelId] = useState<string | null>(null), [threadId, setThreadId] = useState<string | null>(null);
  const [text, setText] = useState(''), [pageCursor, setPageCursor] = useState<string | null>(null), [historyBusy, setHistoryBusy] = useState(false);
  const [located, setLocated] = useState(false), [startRef, setStartRef] = useState<number | null>(null);
  const timelineRef = useRef<ChatTimelineHandle>(null);
  const positions = useRef(new Map<string, TimelinePosition>());
  const locatedThreads = useRef(new Set<string>());
  const olderCursors = useRef(new Map<string, string | null>());
  const [records, setRecords] = useState<SendRecord[]>([]);
  const outboxRef = useRef<MobileOutbox | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const busyRef = useRef(false), markedRef = useRef(new Map<string, number>());
  const openingRef = useRef(0);
  const appActive = useRef(true);

  useEffect(() => {
    let mounted = true;
    SecureStore.getItemAsync(CONFIG_KEY).then(raw => {
      if (!mounted) return;
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') throw new Error('保存的连接无效');
        const c = parsed as Connection;
        const valid = connection(c.baseUrl, c.token, c.id);
        setConfig(valid); setBase(valid.baseUrl);
      }
    }).catch(e => { if (mounted) setError(messageError(e)); }).finally(() => { if (mounted) setReady(true); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!config) { setClient(null); return; }
    let active = true;
    const transport = nativeTransport(config.baseUrl);
    let box: MobileOutbox | null = null;
    const sdk = new HermesClient({ ...transport, token: () => config.token,
      onChange: () => { if (active) { setRevision((n: number) => n + 1); box?.reconcile(); } },
      onConnectionState: (state: NetworkState) => {
        if (!active) return;
        setStatus(networkName[state]); box?.setConnection(state);
        if (state === 'online') { setLoading(false); setError(''); setConnectionEpoch(n => n + 1); box?.reconcile(); }
        if (state === 'blocked') setError('连接权限已失效；请重新连接此设备');
      },
      onError: () => { /* transient transport faults are represented by connection state */ }
    } as ConstructorParameters<typeof HermesClient>[0]);
    box = new MobileOutbox(new OutboxStore(SecureStore, config), sdk, (items, notice) => {
      if (!active) return;
      setRecords(items);
      if (notice) setError(notice);
    });
    outboxRef.current = box;
    setClient(sdk); setStatus('连接中'); setLoading(true); setError('');
    ++openingRef.current; setChannelId(null); setThreadId(null); setPageCursor(null); setLocated(false); setStartRef(null); positions.current.clear(); locatedThreads.current.clear(); olderCursors.current.clear(); markedRef.current.clear(); setRecords([]);
    (async () => {
      try {
        await box.start();
        if (active && appActive.current) await sdk.connect();
      } catch (e) { if (active) { setLoading(false); setError('本机待发消息读取失败；请保留应用数据。' + messageError(e)); } }
    })();
    const receiptPoll = setInterval(() => { if (active && appActive.current) box?.reconcile(); }, 12000);
    return () => { active = false; clearInterval(receiptPoll); ++openingRef.current; sdk.close(); void box?.stop(); if (outboxRef.current === box) outboxRef.current = null; };
  }, [config]);

  useEffect(() => {
    if (!client) return;
    const sub = AppState.addEventListener('change', state => {
      appActive.current = state === 'active';
      if (state !== 'active') { outboxRef.current?.setConnection('suspended'); client.close(); setStatus('后台已暂停'); return; }
      setStatus('连接中');
      client.connect().catch(() => { /* SDK retry loop owns recovery */ });
    });
    return () => sub.remove();
  }, [client]);


  const run = async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(messageError(e)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const saveConnection = () => run(async () => {
    const url = editConnection(config, base, token, Crypto.randomUUID());
    await SecureStore.setItemAsync(CONFIG_KEY, JSON.stringify(url));
    setConfig(url); setEditing(false); setToken('');
  });
  const forget = () => run(async () => {
    const old = outboxRef.current;
    if (old) { await old.stop(); await old.storage.clear(); }
    await SecureStore.deleteItemAsync(CONFIG_KEY);
    setRecords([]); setConfig(null); setClient(null); setToken(''); setEditing(false); setStatus('未连接');
  });
  const openThread = async (id: string) => {
    if (!client) return;
    const opening = ++openingRef.current;
    setThreadId(id); setPageCursor(null); setHistoryBusy(true);
    const cached = locatedThreads.current.has(id);
    setLocated(cached); setStartRef(positions.current.get(id)?.startRef ?? null);
    if (cached) { setPageCursor(olderCursors.current.get(id) ?? null); setHistoryBusy(false); return; }
    try {
      if (client.supportsLatest) {
        const page = await client.historyWindow(id);
        if (opening !== openingRef.current) return;
        olderCursors.current.set(id, page.older_cursor);
        setPageCursor(page.older_cursor); setLocated(true); locatedThreads.current.add(id);
        client.resumeTail(id);
        setStartRef(page.messages[0]?.ref_seq ?? null);
        return;
      }
      // The older server only exposes forward pages. Auto-scan a strictly bounded
      // prefix; never present an oldest page as if it were the latest page.
      const cursor = await locateLatest(after => client.history(id, after, 100), 3, () => opening === openingRef.current);
      if (opening === openingRef.current) {
        setPageCursor(cursor); setLocated(!cursor);
        if (!cursor) {
          client.resumeTail(id);
          locatedThreads.current.add(id);
          const loaded = client.messages.get(id) || [];
          setStartRef(loaded[Math.max(0, loaded.length - 30)]?.ref_seq ?? null);
        }
      }
    } catch { if (opening === openingRef.current) setError('历史暂未载入，连接恢复后将自动补齐'); }
    finally { if (opening === openingRef.current) setHistoryBusy(false); }
  };
  const locateNext = async () => {
    if (!client || !threadId || !pageCursor || historyBusy) return;
    const opening = openingRef.current, id = threadId, cursor = pageCursor;
    setHistoryBusy(true);
    try {
      const page = await client.history(id, cursor, 100);
      if (opening !== openingRef.current) return;
      setPageCursor(page.next_cursor); setLocated(!page.next_cursor);
      if (!page.next_cursor) {
        client.resumeTail(id);
        locatedThreads.current.add(id);
        const loaded = client.messages.get(id) || [];
        setStartRef(loaded[Math.max(0, loaded.length - 30)]?.ref_seq ?? null);
      }
    } catch { if (opening === openingRef.current) setError('历史暂未载入，连接恢复后将自动补齐'); }
    finally { if (opening === openingRef.current) setHistoryBusy(false); }
  };
  const loadOlder = async () => {
    if (!client || !threadId || historyBusy) return;
    timelineRef.current?.holdPosition();
    if (first > 0) { setStartRef(olderStart(messages, visibleMessages[0]?.ref_seq ?? null)); return; }
    if (!client.supportsLatest || !pageCursor) return;
    const opening = openingRef.current, id = threadId;
    setHistoryBusy(true);
    try {
      const page = await client.historyWindow(id, pageCursor);
      if (opening !== openingRef.current) return;
      olderCursors.current.set(id, page.older_cursor); setPageCursor(page.older_cursor);
      setStartRef(page.messages[0]?.ref_seq ?? startRef);
    } catch { if (opening === openingRef.current) setError('历史暂未载入，连接恢复后将自动补齐'); }
    finally { if (opening === openingRef.current) setHistoryBusy(false); }
  };
  const send = () => run(async () => {
    const box = outboxRef.current;
    if (!config || !threadId || !box || box.storage.connectionId !== config.id) return;
    const original = text;
    await box.enqueue(newSend(config, threadId, original, 'mob_' + Crypto.randomUUID()));
    timelineRef.current?.followLatest();
    setText((old: string) => old === original ? '' : old);
  });
  const answer = (item: Interaction, choice: string) => run(async () => {
    if (!client) return;
    const current = await client.getInteraction(item.thread_id, item.id);
    if (current.state !== 'pending' || current.generation !== item.generation) throw new Error('请求已经失效');
    await client.answerInteraction(current, choice);
  });

  const messages = threadId ? client?.messages.get(threadId) || [] : [];
  const first = windowStart(messages, startRef);
  const visibleMessages = located ? messages.slice(first) : [];
  const rows = projectTimeline(visibleMessages, null, threadId || '', threadId ? client?.drafts.get(threadId) : undefined, client?.supportsSendIdentity, records);
  const threadRecords = records.filter(r => r.threadId === threadId);
  const receipts = client && threadId ? [...client.receipts.values()].filter(r => r.thread_id === threadId && ['queued','running','unknown'].includes(r.state)) : [];
  const interactions = client && threadId ? [...client.interactions.values()].filter(i => i.thread_id === threadId && i.state === 'pending') : [];
  const selected = client?.threads.get(threadId || '') as ThreadSummary | undefined;

  const visibleRef = (ref: number) => {
    if (!client || !threadId || !appActive.current) return;
    if (ref <= (markedRef.current.get(threadId) || 0)) return;
    markedRef.current.set(threadId, ref);
    client.markRead(threadId, ref).catch(() => {
      if (markedRef.current.get(threadId) === ref) markedRef.current.delete(threadId);
    });
  };
  useEffect(() => {
    if (client && threadId && located && client.tailIncomplete.has(threadId)) {
      locatedThreads.current.delete(threadId);
      setLocated(false);
      void openThread(threadId);
    }
  }, [revision, client, threadId, located]);
  useEffect(() => {
    if (status === '在线' && client && threadId && !located && !historyBusy && !pageCursor) void openThread(threadId);
  }, [connectionEpoch]);

  if (!ready) return <View style={styles.center}><Text>正在读取安全连接…</Text></View>;
  if (!config || editing) return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
    <Text style={styles.brand}>Hermes App</Text><Text style={styles.subtitle}>连接你的 Hermes · 开发版</Text>
    <Text style={styles.caption}>服务器 HTTPS 地址</Text>
    <TextInput accessibilityLabel="服务器地址" style={styles.input} autoCapitalize="none" autoCorrect={false} keyboardType="url" value={base} onChangeText={setBase} />
    <Text style={styles.caption}>连接凭据（只保存在本机安全存储）</Text>
    <TextInput accessibilityLabel="访问令牌" style={styles.input} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder={config ? '同一服务器可留空；换服务器需重新输入' : '粘贴令牌'} value={token} onChangeText={setToken} />
    <Button title={busy ? '保存中…' : '保存并连接'} disabled={busy} onPress={saveConnection} />
    {config && <View style={styles.row}><Button title="取消" secondary onPress={() => setEditing(false)} /><Button title="清除本机连接" secondary onPress={forget} /></View>}
    <Text style={styles.hint}>切换连接不会把旧连接的待发消息发送到新连接。本机凭据不会写入 URL 或应用包。</Text>
    {!!error && <Text style={styles.error}>{error}</Text>}
  </ScrollView>;

  return <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={styles.header}>
      <View style={styles.flex}><Text style={styles.brandSmall}>Hermes App</Text><Text style={styles.subtitle} numberOfLines={1}>{config.baseUrl} · {status}</Text></View>
      <Button title="连接" secondary onPress={() => setEditing(true)} />
    </View>
    {!!error && <Text style={styles.error}>{error}</Text>}
    {loading && <Text style={styles.hint}>正在载入频道和同步状态…</Text>}
    {records.some(r => r.receiptState === 'unknown') && <Text style={styles.hint}>有执行结果尚未确认；应用会继续核对，不会自动重新执行。</Text>}
    {threadId && client ? <>
      <View style={styles.row}><Button title="‹ 话题" secondary onPress={() => { ++openingRef.current; setThreadId(null); setPageCursor(null); }} /><Text style={styles.heading} numberOfLines={1}>{selected?.title || '对话'}</Text></View>
      <ChatTimeline key={threadId} ref={timelineRef} threadId={threadId} rows={rows}
        startRef={visibleMessages[0]?.ref_seq ?? null} hasOlder={located && (first > 0 || !!pageCursor && client.supportsLatest)}
        locatingMessage={!located ? historyBusy ? '正在定位最新消息…' : pageCursor ? '历史超过首批有界范围；服务端缺少倒序/向前游标，尚不能直接定位最新。可逐页继续查找，不会将最早消息冒充最新。' : '等待网络恢复后自动载入历史…' : undefined}
        onLocateNext={!located && pageCursor ? () => { void locateNext(); } : undefined} locatingBusy={historyBusy}
        onOlder={() => { void loadOlder(); }}
        position={positions.current.get(threadId)} onPosition={value => positions.current.set(threadId, value)} onVisibleRef={visibleRef}
        text={text} onText={setText} onSend={send} records={threadRecords}
        receipts={receipts} interactions={interactions} answers={answers}
        onAnswerText={(id, value) => setAnswers(old => ({ ...old, [id]: value }))} onAnswer={answer}
        onCancel={r => run(async () => { await client.cancelQueued(threadId, r.id); })}
        onStop={() => run(async () => { const stopped = await client.stop(threadId); if (!stopped) throw new Error('当前没有可停止的执行'); })} busy={busy} />
    </> : client ? <ChannelScreens client={client} channelId={channelId} onChannel={setChannelId} onThread={id => { void openThread(id); }} /> : null}
  </KeyboardAvoidingView>;
}
export default function App() { return <SafeAreaProvider><SafeAreaView style={styles.safe} edges={['top','bottom','left','right']}><Screen /></SafeAreaView></SafeAreaProvider>; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' }, flex: { flex: 1 }, center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  form: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 14 }, header: { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 6, borderBottomWidth: 1, borderColor: '#e2e8f0' },
  brand: { fontSize: 30, fontWeight: '700', color: '#14283e' }, brandSmall: { fontSize: 19, fontWeight: '700', color: '#14283e' }, subtitle: { color: '#64748b', fontSize: 12 },
  heading: { fontSize: 16, fontWeight: '600', color: '#172a40', flexShrink: 1 }, caption: { color: '#607187', fontSize: 12 }, hint: { color: '#607187', fontSize: 12, margin: 9 }, error: { color: '#9d1b32', backgroundColor: '#fff0f2', padding: 10 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cdd7e3', borderRadius: 10, minHeight: 42, paddingHorizontal: 12, paddingVertical: 8, color: '#172a40' },
  button: { backgroundColor: '#2960ad', borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', margin: 2 }, secondary: { backgroundColor: '#e6edf7' }, disabled: { opacity: 0.5 }, buttonText: { color: '#fff', fontWeight: '600', fontSize: 13 }, secondaryText: { color: '#2b4e81' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, flexWrap: 'wrap' }, create: { gap: 6, padding: 10 }, listItem: { backgroundColor: '#fff', marginHorizontal: 10, marginVertical: 4, padding: 15, borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0' },
  card: { backgroundColor: '#fff8e8', borderColor: '#edd8a1', borderWidth: 1, padding: 10, margin: 8, borderRadius: 9, gap: 5 }

});
