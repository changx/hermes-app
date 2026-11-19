import React, { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { Text } from './FontSize';
import { openLink } from './openLink';
import { copyWithToast } from './CopyToast';
import type { MessageSource } from '../../../packages/client/src/index';
import type { TimelineRow } from './timeline';
import { sideMarkLabel } from '../../../packages/client/src/sideChats';

/** A side chat as the anchor mark lists it (docs/side-chat.md). */
export type SideChatRow = Readonly<{ id: string; title: string; running?: boolean; completed_unread?: boolean }>;

/** Actions under a final reply. Absent handlers hide their button. */
export interface MessageActions {
  branch?(row: TimelineRow): Promise<void>;
  /** New side chat from this message; resolves when it opened or failed (the server waits while the Session runs). */
  side?(row: TimelineRow): Promise<void>;
  /** Side chat page: put this reply, with a link back, into the source Session's composer. */
  toMain?(row: TimelineRow): void;
  /** Anchor mark: open one side chat, or choose among several. */
  openSides?(sides: readonly SideChatRow[]): void;
  sources?(row: TimelineRow): Promise<MessageSource[]>;
  exportMessage?(row: TimelineRow): void;
  retry?(row: TimelineRow): void;
}

function ToolButton({ label, ios, android, onPress, disabled = false, busy = false, active = false }: { label: string; ios: SFSymbol; android: AndroidSymbol; onPress: () => void; disabled?: boolean; busy?: boolean; active?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy, expanded: active || undefined }}
    disabled={disabled || busy} hitSlop={6} onPress={onPress} style={({ pressed }) => [styles.button, pressed && styles.pressed, disabled && styles.disabled]}>
    {busy ? <ActivityIndicator size="small" color="#7b8794" />
      : <SymbolView name={{ ios, android }} size={16} tintColor={active ? '#2b4e81' : '#7b8794'} weight="regular" fallback={<Text style={styles.fallback}>{label}</Text>} />}
  </Pressable>;
}

/** Copy icon in the user message's bottom row. Copies the original message text. */
export function MessageCopyButton({ text }: { text: string }) {
  return <Pressable testID="user-message-copy" accessibilityRole="button" accessibilityLabel="Copy message" hitSlop={8}
    onPress={() => { void copyWithToast(text); }} style={({ pressed }) => [styles.inlineButton, pressed && styles.pressed]}>
    <SymbolView name={{ ios: 'doc.on.doc', android: 'content_copy' }} size={13} tintColor="#8a94a0" weight="regular" fallback={<Text style={styles.fallback}>Copy</Text>} />
  </Pressable>;
}

const sourceLabel = (url: string) => { try { const u = new URL(url); return u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname); } catch { return url; } };

/** Compact, always-visible row under a final reply: Branch, Copy, References, Export, Retry. */
export function MessageToolbar({ row, actions, canRetry, running }: { row: TimelineRow; actions: MessageActions; canRetry: boolean; running: boolean }) {
  const [branching, setBranching] = useState(false), [siding, setSiding] = useState(false);
  const [sources, setSources] = useState<{ open: boolean; items?: MessageSource[]; loading?: boolean; failed?: boolean }>({ open: false });
  const mounted = useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const loadSources = async () => {
    if (!actions.sources) return;
    if (sources.open) { setSources(old => ({ ...old, open: false })); return; }
    if (sources.items) { setSources(old => ({ ...old, open: true })); return; }
    setSources({ open: true, loading: true });
    try { const items = await actions.sources(row); if (mounted.current) setSources({ open: true, items }); }
    catch { if (mounted.current) setSources({ open: true, failed: true }); }
  };
  return <View testID="message-toolbar">
    <View style={styles.row}>
      {!!actions.toMain && <ToolButton label="Send to main" ios="arrowshape.turn.up.left" android="reply" onPress={() => actions.toMain!(row)} />}
      {!!actions.side && <ToolButton label="Side chat" ios="bubble.left.and.bubble.right" android="forum" busy={siding}
        onPress={() => { setSiding(true); void actions.side!(row).finally(() => { if (mounted.current) setSiding(false); }); }} />}
      {!!actions.branch && <ToolButton label="Branch" ios="arrow.triangle.branch" android="call_split" busy={branching} disabled={running}
        onPress={() => { setBranching(true); void actions.branch!(row).finally(() => { if (mounted.current) setBranching(false); }); }} />}
      <ToolButton label="Copy" ios="doc.on.doc" android="content_copy" onPress={() => { void copyWithToast(row.text); }} />
      {!!actions.sources && <ToolButton label="References" ios="link" android="link" active={sources.open} onPress={() => { void loadSources(); }} />}
      {!!actions.exportMessage && <ToolButton label="Export" ios="square.and.arrow.up" android="ios_share" onPress={() => actions.exportMessage!(row)} />}
      {canRetry && !!actions.retry && <ToolButton label="Retry" ios="arrow.clockwise" android="refresh" disabled={running} onPress={() => actions.retry!(row)} />}
      {!!row.model && <Text testID="message-model" style={styles.model} numberOfLines={1} accessibilityLabel={`Generated by ${row.model}`}>{row.model}</Text>}
    </View>
    {sources.open && <View style={styles.sources} accessibilityLiveRegion="polite">
      {sources.loading ? <Text style={styles.note}>Loading references…</Text>
        : sources.failed ? <Text style={styles.note}>Could not load references. Try again later.</Text>
        : !sources.items?.length ? <Text style={styles.note}>No web pages were used for this reply.</Text>
        : sources.items.map(item => <Pressable key={item.url} accessibilityRole="link" accessibilityLabel={item.url} onPress={() => openLink(item.url)} style={styles.source}>
          <Text numberOfLines={1} style={styles.sourceText}>{sourceLabel(item.url)}</Text>
          {item.kind === 'cited' && <Text style={styles.kind}>cited</Text>}
        </Pressable>)}
    </View>}
  </View>;
}

/** Under an anchor message of the source Session: not a message; it opens the side chat(s). */
export function SideMark({ sides, onOpen }: { sides: readonly SideChatRow[]; onOpen: (sides: readonly SideChatRow[]) => void }) {
  const running = sides.some(side => side.running), unread = sides.some(side => side.completed_unread);
  const text = sideMarkLabel(sides.length);
  return <View style={styles.markRow}>
    <Pressable testID="side-mark" accessibilityRole="button" accessibilityLabel={[text, running && 'running', unread && 'unread result'].filter(Boolean).join(', ')} hitSlop={6}
      onPress={() => onOpen(sides)} style={({ pressed }) => [styles.mark, pressed && styles.pressed]}>
      <SymbolView name={{ ios: 'bubble.left.and.bubble.right', android: 'forum' }} size={13} tintColor="#697b90" weight="regular" fallback={null} />
      <Text style={styles.markText}>{text}</Text>
      {running && <View style={[styles.dot, styles.running]} />}
      {unread && <View style={[styles.dot, styles.unread]} />}
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  markRow: { flexDirection: 'row', marginTop: 6, marginLeft: -4 },
  mark: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: '#cfd6de' },
  markText: { color: '#697b90', fontSize: 12 },
  dot: { width: 7, height: 7, borderRadius: 4 }, running: { backgroundColor: '#16a34a' }, unread: { backgroundColor: '#4DA3FF' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 8, marginLeft: -6 },
  button: { width: 34, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  pressed: { backgroundColor: '#ebe8df' },
  inlineButton: { width: 22, height: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 6, marginRight: 6 },
  disabled: { opacity: 0.4 },
  fallback: { color: '#7b8794', fontSize: 11 },
  sources: { marginTop: 4, gap: 2 },
  source: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5 },
  sourceText: { color: '#215ca7', fontSize: 13, flexShrink: 1 },
  kind: { color: '#8a94a0', fontSize: 11 },
  note: { color: '#697b90', fontSize: 13, paddingVertical: 4 },
  model: { flexShrink: 1, marginLeft: 'auto', paddingLeft: 12, color: '#8a94a0', fontSize: 12 },
});
