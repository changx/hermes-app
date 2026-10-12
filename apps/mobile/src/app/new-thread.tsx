import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConnectionScope, FormKeyboardAvoidingView, Notice, useApp, useConnections } from '../App';
import { Text } from '../FontSize';
import { NewTopicComposer } from '../NewTopicComposer';
import { newSend } from '../send';
import { channelChoices, recentChannel, type ChannelChoice } from '../recentRows';
import { threadRoute } from '../sessionNavigation';

/**
 * New conversation from Recents: choose a channel, write the first message.
 * With `automation=1` (Automations tab or a channel's Automations page) the new
 * Thread is the settings conversation of an automation that the agent drafts
 * and creates in it; `channel` + `connection` preselect the channel.
 * The composer and the durable first-message path are the same as at the
 * bottom of a channel page. The channel can change until the first send
 * attempt; from then on the attempt's IDs belong to that channel.
 */
export default function NewThread() {
  const { ready, connections, revision } = useConnections();
  const params = useLocalSearchParams<{ automation?: string; channel?: string; connection?: string }>();
  const automation = params.automation === '1';
  const sources = useMemo(() => automation ? connections.filter(c => c.client?.supportsAutomationEditors) : connections, [automation, connections, revision]);
  const choices = useMemo(() => channelChoices(sources), [sources, revision]);
  const [picked, setPicked] = useState<string | null>(null);
  const preselected = useRef<string | null>(null);
  // Preselect once, when the directory first allows it; never override the user.
  if (picked === null && preselected.current === null && choices.length) {
    const asked = params.channel && params.connection ? `${params.connection}:${params.channel}` : null;
    preselected.current = (asked && choices.some(c => c.key === asked) ? asked : null) ?? recentChannel(sources, choices)?.key ?? null;
  }
  const target = choices.find(choice => choice.key === (picked ?? preselected.current)) ?? null;
  const [locked, setLocked] = useState(false);
  const [choosing, setChoosing] = useState(false);
  // Open the keyboard only after the push animation. The first keyboard of
  // the app process is slow to appear; together with the push it stutters.
  const navigation = useNavigation();
  const [entered, setEntered] = useState(false);
  useEffect(() => (navigation as unknown as TransitionEvents).addListener('transitionEnd', event => {
    if (!event?.data?.closing) setEntered(true);
  }), [navigation]);
  const title = automation ? <Stack.Screen options={{ title: 'New automation' }} /> : null;
  if (!ready) return <Notice text="" />;
  if (automation && !connections.some(c => c.client?.supportsAutomationEditors))
    return <>{title}<Notice text="Creating automations needs a newer server. Ask the agent in any conversation instead." /></>;
  if (!choices.length) return <>{title}<Notice text="Create a channel first. Conversations belong to a channel." /></>;
  if (!target) return <>{title}<Notice text="This channel is unavailable." /></>;
  return <SafeAreaView style={s.fill} edges={['bottom', 'left', 'right']}>
    {title}
    <ChannelField target={target} disabled={locked} onPress={() => setChoosing(true)} />
    <ConnectionScope slot={target.slot} fallback={<Notice text="This channel is unavailable." />}>
      <Composer channel={target} onLock={setLocked} focus={entered} automation={automation} />
    </ConnectionScope>
    <ChannelPicker visible={choosing} choices={choices} selected={target.key}
      onClose={() => setChoosing(false)} onPick={key => { setChoosing(false); if (!locked) setPicked(key); }} />
  </SafeAreaView>;
}

function ChannelField({ target, disabled, onPress }: { target: ChannelChoice; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Channel: ${target.name}, ${target.connectionName}`}
    accessibilityHint={disabled ? undefined : 'Choose another channel'} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [s.field, pressed && s.pressed, disabled && s.disabled]}>
    <Text style={s.fieldLabel}>Channel</Text>
    <View style={s.fill}>
      <Text numberOfLines={1} style={s.fieldValue}>{target.name}</Text>
      <Text numberOfLines={1} style={s.fieldSource}>{target.connectionName}</Text>
    </View>
    {!disabled && <Text style={s.change}>Change</Text>}
  </Pressable>;
}

type TransitionEvents = { addListener: (type: 'transitionEnd', listener: (event: { data?: { closing?: boolean } }) => void) => () => void };

function Composer({ channel, onLock, focus, automation }: { channel: ChannelChoice; onLock: (locked: boolean) => void; focus: boolean; automation: boolean }) {
  const { client, config, outboxRef } = useApp();
  const router = useRouter();
  useEffect(() => () => onLock(false), [onLock]);
  if (!client || !config) return <Notice text="Opening…" />;
  if (!client.channels.has(channel.id)) return <Notice text="This channel is unavailable." />;
  return <FormKeyboardAvoidingView>
    <View style={s.fill} />
    <NewTopicComposer client={client} channelId={channel.id} onTargetLock={onLock} autoFocus={focus} showModel
      placeholder={automation ? 'What should run, and when?' : 'What would you like to do?'} automationEditor={automation}
      enqueue={async (threadId, messageId, text, attachments, create) => {
        const box = outboxRef.current;
        if (!box || box.storage.connectionId !== config.id) throw new Error('Connection changed');
        await box.enqueue(newSend(config, threadId, text, messageId, attachments, create));
      }}
      // Replace this page: Back from the new conversation returns to Recents.
      onCreated={threadId => router.replace(threadRoute(channel.slot, threadId))} />
  </FormKeyboardAvoidingView>;
}

function ChannelPicker({ visible, choices, selected, onClose, onPick }: {
  visible: boolean; choices: readonly ChannelChoice[]; selected: string; onClose: () => void; onPick: (key: string) => void;
}) {
  const insets = useSafeAreaInsets();
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <View style={[s.sheet, { paddingBottom: insets.bottom }]}>
      <View style={s.sheetHeader}>
        <Text accessibilityRole="header" style={s.sheetTitle}>Choose a channel</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel" hitSlop={8} onPress={onClose}><Text style={s.change}>Cancel</Text></Pressable>
      </View>
      <FlatList data={choices} keyExtractor={item => item.key} contentContainerStyle={s.list}
        renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityState={{ selected: item.key === selected }}
          accessibilityLabel={`${item.name}, ${item.connectionName}`} onPress={() => onPick(item.key)}
          style={({ pressed }) => [s.option, item.key === selected && s.selected, pressed && s.pressed]}>
          <View style={s.fill}>
            <Text numberOfLines={1} style={s.fieldValue}>{item.name}</Text>
            <Text numberOfLines={1} style={s.fieldSource}>{item.connectionName}</Text>
          </View>
          {item.key === selected && <Text style={s.check}>✓</Text>}
        </Pressable>} />
    </View>
  </Modal>;
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#e2e8f0' },
  fieldLabel: { fontSize: 15, color: '#607187', width: 72 },
  fieldValue: { fontSize: 17, fontWeight: '600', color: '#172a40' },
  fieldSource: { fontSize: 13, color: '#607187', marginTop: 2 },
  change: { fontSize: 15, fontWeight: '600', color: '#2b4e81' },
  pressed: { backgroundColor: '#eef3fa' }, disabled: { opacity: 0.6 },
  sheet: { flex: 1, backgroundColor: '#f8fafc' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderColor: '#e2e8f0' },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: '#14283e' },
  list: { padding: 12 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 8 },
  selected: { borderColor: '#2960ad' },
  check: { fontSize: 17, fontWeight: '700', color: '#2960ad' },
});
