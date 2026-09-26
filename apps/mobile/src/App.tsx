import React, { useEffect, useRef, useState } from 'react';
import { AppState, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { HermesClient, ResyncRequired } from '../../../packages/client/src/index';
import type { Interaction, ThreadSummary } from '../../../packages/client/src/index';
import { nativeTransport } from './transport';
import { DEFAULT_BASE, accepted, connection, editConnection, newSend, restoreSend, retrySend } from './send';
import type { Connection, SendRecord } from './send';
import { ChatTimeline, type ChatTimelineHandle } from './ChatTimeline';
import { locateLatest, olderStart, projectTimeline, windowStart, type TimelinePosition } from './timeline';

const CONFIG_KEY = 'hermes-app-connection-v1';
const SEND_KEY = 'hermes-app-last-send-v1';
const messageError = (e: unknown) => e instanceof Error ? e.message : '操作失败';

function Button({ title, onPress, disabled = false, secondary = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, secondary && styles.secondary, disabled && styles.disabled]}><Text style={[styles.buttonText, secondary && styles.secondaryText]}>{title}</Text></Pressable>;
}
function Screen() {
  const [config, setConfig] = useState<Connection | null>(null);
  const [ready, setReady] = useState(false), [editing, setEditing] = useState(false);
  const [base, setBase] = useState(DEFAULT_BASE), [token, setToken] = useState('');
  const [client, setClient] = useState<HermesClient | null>(null);
  const [revision, setRevision] = useState(0), [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false), [status, setStatus] = useState('未连接'), [error, setError] = useState('');
  const [channelId, setChannelId] = useState<string | null>(null), [threadId, setThreadId] = useState<string | null>(null);
  const [channelName, setChannelName] = useState(''), [description, setDescription] = useState(''), [threadTitle, setThreadTitle] = useState('');
  const [text, setText] = useState(''), [pageCursor, setPageCursor] = useState<string | null>(null), [historyBusy, setHistoryBusy] = useState(false);
  const [located, setLocated] = useState(false), [startRef, setStartRef] = useState<number | null>(null);
  const timelineRef = useRef<ChatTimelineHandle>(null);
  const positions = useRef(new Map<string, TimelinePosition>());
  const locatedThreads = useRef(new Set<string>());
  const [record, setRecord] = useState<SendRecord | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const recordRef = useRef<SendRecord | null>(null), busyRef = useRef(false), markedRef = useRef(new Map<string, number>());
  const openingRef = useRef(0);
  const appActive = useRef(true);
  const updateRecord = (value: SendRecord | null) => { recordRef.current = value; setRecord(value); };

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
    const sdk = new HermesClient({ ...transport, token: () => config.token,
      onChange: () => { if (active) setRevision(n => n + 1); },
      onError: e => { if (active) { setStatus('重连中'); setError(e instanceof ResyncRequired ? '同步游标失效，请点「重建同步」' : messageError(e)); } }
    });
    setClient(sdk); setStatus('连接中'); setLoading(true); setError('');
    ++openingRef.current; setChannelId(null); setThreadId(null); setPageCursor(null); setLocated(false); setStartRef(null); positions.current.clear(); locatedThreads.current.clear(); markedRef.current.clear();
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(SEND_KEY);
        if (!active) return;
        updateRecord(restoreSend(stored, config));
        await sdk.capabilities();
        await sdk.catchUp();
        if (!active) return;
        const saved = recordRef.current;
        if (saved?.status === 'accepted' && saved.receiptId && saved.connectionId === config.id) {
          // Completed receipts are absent from the bounded active snapshot.
          const current = await sdk.getReceipt(saved.receiptId);
          const updated = { ...saved, receiptState: current.state };
          updateRecord(updated);
          await SecureStore.setItemAsync(SEND_KEY, JSON.stringify(updated));
        }
        setStatus('已同步');
        if (appActive.current) await sdk.connect();
      } catch (e) { if (active) { setStatus('连接失败'); setError(messageError(e)); } }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; sdk.close(); };
  }, [config]);

  useEffect(() => {
    if (!client) return;
    const sub = AppState.addEventListener('change', state => {
      appActive.current = state === 'active';
      if (state !== 'active') { client.close(); setStatus('后台已断开'); return; }
      setStatus('补齐中');
      client.catchUp().then(() => { setStatus('已同步'); setError(''); return client.connect(); })
        .catch(e => { setStatus('同步失败'); setError(messageError(e)); });
    });
    return () => sub.remove();
  }, [client]);

  useEffect(() => {
    if (!client || !record?.receiptId || record.connectionId !== config?.id) return;
    const current = client.receipts.get(record.receiptId);
    if (current && current.state !== record.receiptState) {
      const next = { ...record, receiptState: current.state };
      updateRecord(next);
      SecureStore.setItemAsync(SEND_KEY, JSON.stringify(next)).catch(e => setError('收据状态保存失败：' + messageError(e)));
    }
  }, [revision, client, record, config]);

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
    await SecureStore.deleteItemAsync(CONFIG_KEY);
    await SecureStore.deleteItemAsync(SEND_KEY);
    updateRecord(null); setConfig(null); setClient(null); setToken(''); setEditing(false); setStatus('未连接');
  });
  const sync = () => run(async () => {
    if (!client) return;
    client.close(); setStatus('补齐中');
    try { await client.catchUp(); }
    catch (e) {
      if (!(e instanceof ResyncRequired)) throw e;
      await client.resync();
      locatedThreads.current.clear(); positions.current.clear(); markedRef.current.clear();
      if (threadId) await openThread(threadId);
    }
    await client.connect(); setStatus('已同步');
  });
  const openThread = async (id: string) => {
    if (!client) return;
    const opening = ++openingRef.current;
    setThreadId(id); setPageCursor(null); setHistoryBusy(true);
    const cached = locatedThreads.current.has(id);
    setLocated(cached); setStartRef(positions.current.get(id)?.startRef ?? null);
    if (cached) { setHistoryBusy(false); return; }
    try {
      // The server only exposes forward pages. Auto-scan a strictly bounded
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
    } catch (e) { if (opening === openingRef.current) setError(messageError(e)); }
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
    } catch (e) { if (opening === openingRef.current) setError(messageError(e)); }
    finally { if (opening === openingRef.current) setHistoryBusy(false); }
  };
  const submitRecord = async (draft: SendRecord) => {
    if (!client) return;
    // Persist exact ID/body before network I/O. Never generate a new ID on ambiguous response.
    await SecureStore.setItemAsync(SEND_KEY, JSON.stringify(draft)); updateRecord(draft);
    try {
      const receipt = await client.send(draft.threadId, draft.clientMessageId, draft.text);
      const next = accepted(draft, receipt);
      updateRecord(next);
      await SecureStore.setItemAsync(SEND_KEY, JSON.stringify(next));
      setText(old => old === draft.text ? '' : old);
      await client.historyTail(draft.threadId);
    } catch (e) {
      if (recordRef.current?.status === 'sending') {
        const next = { ...draft, status: 'ambiguous' as const };
        updateRecord(next);
        await SecureStore.setItemAsync(SEND_KEY, JSON.stringify(next));
      }
      throw e;
    }
  };
  const send = () => run(async () => {
    if (!config || !threadId) return;
    if (record?.status === 'ambiguous') throw new Error('先原样重试，或明确放弃旧消息后再新发');
    timelineRef.current?.followLatest();
    await submitRecord(newSend(config, threadId, text, 'mob_' + Crypto.randomUUID()));
  });
  const retry = () => run(async () => { if (record && config) await submitRecord(retrySend(config, record)); });
  const abandon = () => run(async () => {
    // This only removes a local retry affordance; a possibly accepted server job continues.
    await SecureStore.deleteItemAsync(SEND_KEY); updateRecord(null);
  });
  const answer = (item: Interaction, choice: string) => run(async () => {
    if (!client) return;
    const current = await client.getInteraction(item.thread_id, item.id);
    if (current.state !== 'pending' || current.generation !== item.generation) throw new Error('请求已经失效');
    await client.answerInteraction(current, choice);
  });

  const channels = client ? [...client.channels.values()].sort((a, b) => a.name.localeCompare(b.name)) : [];
  const threads = client ? [...client.threads.values()].filter(t => t.project_id === channelId && !t.archived).sort((a, b) => a.title.localeCompare(b.title)) : [];
  const messages = threadId ? client?.messages.get(threadId) || [] : [];
  const first = windowStart(messages, startRef);
  const visibleMessages = located ? messages.slice(first) : [];
  const rows = projectTimeline(visibleMessages, record, threadId || '', threadId ? client?.drafts.get(threadId) : undefined);
  const receipts = client && threadId ? [...client.receipts.values()].filter(r => r.thread_id === threadId && ['queued','running','unknown'].includes(r.state)) : [];
  const interactions = client && threadId ? [...client.interactions.values()].filter(i => i.thread_id === threadId && i.state === 'pending') : [];
  const selected = client?.threads.get(threadId || '') as ThreadSummary | undefined;
  const visibleRef = (ref: number) => {
    if (!client || !threadId || !appActive.current) return;
    if (ref <= (markedRef.current.get(threadId) || 0)) return;
    markedRef.current.set(threadId, ref);
    client.markRead(threadId, ref).catch(e => {
      if (markedRef.current.get(threadId) === ref) markedRef.current.delete(threadId);
      setError(messageError(e));
    });
  };
  useEffect(() => {
    if (client && threadId && located && client.tailIncomplete.has(threadId)) {
      locatedThreads.current.delete(threadId);
      setLocated(false);
      void openThread(threadId);
    }
  }, [revision, client, threadId, located]);

  if (!ready) return <View style={styles.center}><Text>正在读取安全连接…</Text></View>;
  if (!config || editing) return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
    <Text style={styles.brand}>Hermes App</Text><Text style={styles.subtitle}>连接你的 Hermes · 开发版</Text>
    <Text style={styles.caption}>服务器 HTTPS 地址</Text>
    <TextInput accessibilityLabel="服务器地址" style={styles.input} autoCapitalize="none" autoCorrect={false} keyboardType="url" value={base} onChangeText={setBase} />
    <Text style={styles.caption}>访问令牌（只保存在本机 SecureStore）</Text>
    <TextInput accessibilityLabel="访问令牌" style={styles.input} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder={config ? '同一服务器可留空；换服务器需重新输入' : '粘贴令牌'} value={token} onChangeText={setToken} />
    <Button title={busy ? '保存中…' : '保存并连接'} disabled={busy} onPress={saveConnection} />
    {config && <View style={styles.row}><Button title="取消" secondary onPress={() => setEditing(false)} /><Button title="清除本机连接" secondary onPress={forget} /></View>}
    <Text style={styles.hint}>切换连接会清除当前界面的消息；结果不明的旧发送须在原连接处理。令牌不会写入 URL 或应用包。</Text>
    {!!error && <Text style={styles.error}>{error}</Text>}
  </ScrollView>;

  return <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={styles.header}>
      <View style={styles.flex}><Text style={styles.brandSmall}>Hermes App</Text><Text style={styles.subtitle} numberOfLines={1}>{config.baseUrl} · {status}</Text></View>
      <Button title="同步" secondary disabled={busy} onPress={sync} />
      <Button title="连接" secondary onPress={() => setEditing(true)} />
    </View>
    {!!error && <Text style={styles.error}>{error}</Text>}
    {loading && <Text style={styles.hint}>正在载入频道和同步状态…</Text>}
    {record?.status === 'ambiguous' && record.threadId !== threadId && <View style={styles.card}>
      <Text>有一条接收结果不明的消息；新发送已暂停，避免误当重试。</Text>
      <Button title="前往待确认话题" secondary onPress={() => { setChannelId(client?.threads.get(record.threadId)?.project_id || null); void openThread(record.threadId); }} />
    </View>}
    {threadId && client ? <>
      <View style={styles.row}><Button title="‹ 话题" secondary onPress={() => { ++openingRef.current; setThreadId(null); setPageCursor(null); }} /><Text style={styles.heading} numberOfLines={1}>{selected?.title || '对话'}</Text></View>
      <ChatTimeline key={threadId} ref={timelineRef} threadId={threadId} rows={rows}
        startRef={visibleMessages[0]?.ref_seq ?? null} hasOlder={located && first > 0}
        locatingMessage={!located ? historyBusy ? '正在定位最新消息…' : pageCursor ? '历史超过首批有界范围；服务端缺少倒序/向前游标，尚不能直接定位最新。可逐页继续查找，不会将最早消息冒充最新。' : '历史载入失败，请返回话题重试。' : undefined}
        onLocateNext={pageCursor ? () => { void locateNext(); } : undefined} locatingBusy={historyBusy}
        onOlder={() => { timelineRef.current?.holdPosition(); setStartRef(olderStart(messages, visibleMessages[0]?.ref_seq ?? null)); }}
        position={positions.current.get(threadId)} onPosition={value => positions.current.set(threadId, value)} onVisibleRef={visibleRef}
        text={text} onText={setText} onSend={send} record={record} onRetry={retry} onAbandon={abandon}
        receipts={receipts} interactions={interactions} answers={answers}
        onAnswerText={(id, value) => setAnswers(old => ({ ...old, [id]: value }))} onAnswer={answer}
        onCancel={r => run(async () => { await client.cancelQueued(threadId, r.id); })}
        onStop={() => run(async () => { const stopped = await client.stop(threadId); if (!stopped) throw new Error('当前没有可停止的执行'); })} busy={busy} />
    </> : channelId && client ? <>
      <View style={styles.row}><Button title="‹ 频道" secondary onPress={() => setChannelId(null)} /><Text style={styles.heading}>{client.channels.get(channelId)?.name}</Text></View>
      <Text style={styles.hint}>{client.channels.get(channelId)?.description || '此频道暂无说明'}</Text>
      <View style={styles.row}><TextInput accessibilityLabel="新话题标题" style={[styles.input, styles.flex]} placeholder="新话题标题" value={threadTitle} onChangeText={setThreadTitle} /><Button title="创建" disabled={busy || !threadTitle.trim()} onPress={() => run(async () => { const t = await client.createThread(channelId, threadTitle.trim()); await client.getThread(t.id); setThreadTitle(''); await openThread(t.id); })} /></View>
      <FlatList data={threads} keyExtractor={t => t.id} renderItem={({ item }) => <Pressable style={styles.listItem} onPress={() => openThread(item.id)}><Text style={styles.heading}>{item.title}</Text><Text style={styles.hint}>未读 {item.unread_count || 0} · 最近 #{item.last_ref || 0}</Text></Pressable>} ListEmptyComponent={<Text style={styles.hint}>暂无话题，可以创建一个。</Text>} />
    </> : <>
      <Text style={styles.heading}>频道</Text>
      <View style={styles.create}><TextInput accessibilityLabel="频道名称" style={styles.input} placeholder="频道名称" value={channelName} onChangeText={setChannelName} /><TextInput accessibilityLabel="频道说明" multiline style={styles.input} placeholder="公共说明（仅新会话初始化时生效）" value={description} onChangeText={setDescription} /><Button title="创建频道" disabled={busy || !channelName.trim()} onPress={() => run(async () => { const c = await client?.createChannel(channelName.trim(), description); if (c) { setChannelName(''); setDescription(''); setChannelId(c.id); } })} /></View>
      <FlatList data={channels} keyExtractor={c => c.id} renderItem={({ item }) => <Pressable style={styles.listItem} onPress={() => setChannelId(item.id)}><Text style={styles.heading}>{item.name}</Text><Text style={styles.hint} numberOfLines={2}>{item.description || '无说明'}</Text></Pressable>} ListEmptyComponent={<Text style={styles.hint}>暂无频道；若连接失败，请检查令牌和网络。</Text>} />
    </>}
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
