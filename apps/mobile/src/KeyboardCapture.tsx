import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Dimensions, Keyboard, type KeyboardEvent, type LayoutChangeEvent,
  Modal, Platform, Pressable, Share, StyleSheet, View } from 'react-native';
import type { KeyboardAvoidingView } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { Text } from './FontSize';
import { KEYBOARD_REPORT_BUILD, KeyboardReport, type KeyboardKind, type ReportRoute } from './keyboardReport';

const report = new KeyboardReport();
const reportFile = () => new File(Paths.cache, 'hermes-keyboard-report.json');
let loaded = false, writeTimer: ReturnType<typeof setTimeout> | undefined;
let storageFailed = false;
function load() {
  if (loaded) return;
  loaded = true;
  try { const file = reportFile(); if (file.exists && file.size <= 1000000) report.restore(JSON.parse(file.textSync())); }
  catch { storageFailed = true; }
}
function flush() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = undefined;
  try { reportFile().write(JSON.stringify(report.snapshot(), null, 2)); storageFailed = false; }
  catch { storageFailed = true; }
}
function record(kind: string, route: ReportRoute, data: Record<string, unknown> = {}) {
  load(); if (!report.append(kind, route, data)) return;
  if (!writeTimer) writeTimer = setTimeout(flush, 250);
}
export type FormKeyboardProbe = {
  ref: React.RefObject<KeyboardAvoidingView | null>;
  onLayout: (event: LayoutChangeEvent) => void;
};
export function useKeyboardCapture(route: ReportRoute, focused: boolean) {
  const ref = useRef<KeyboardAvoidingView>(null);
  const focus = useRef(focused); focus.current = focused;
  useEffect(() => {
    load();
    let alive = true;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const dimensions = () => {
      const window = Dimensions.get('window'), screen = Dimensions.get('screen');
      return { windowWidth: window.width, windowHeight: window.height, screenWidth: screen.width,
        screenHeight: screen.height, fontScale: window.fontScale };
    };
    const sample = (sampleDelay: number) => {
      if (!alive || !focus.current) return;
      const kav = ref.current;
      // Read only the pinned RN component's public React state. Never mutate it.
      const state = kav?.state as { bottom?: number } | undefined;
      const data = { ...dimensions(), sampleDelay, appState: AppState.currentState,
        focused: focus.current, rnVisible: Keyboard.isVisible(), storedBottom: state?.bottom,
        paddingBottom: kav?.props.enabled === false ? 0 : state?.bottom };
      record('sample', route, data);
      const host = (kav as unknown as { viewRef?: { current?: View | null } })?.viewRef?.current;
      host?.measureInWindow((x, y, width, height) => {
        if (alive && focus.current) record('sample', route, { ...data,
          measuredX: x, measuredY: y, measuredWidth: width, measuredHeight: height });
      });
    };
    const schedule = () => {
      timers.forEach(clearTimeout); timers.clear();
      for (const delay of [0, 32, 150, 400, 900, 1800]) {
        const timer = setTimeout(() => { timers.delete(timer); sample(delay); }, delay);
        timers.add(timer);
      }
    };
    record('mount', route, { ...dimensions(), appState: AppState.currentState, focused: focus.current });
    const events = ['keyboardWillShow', 'keyboardDidShow', 'keyboardWillHide', 'keyboardDidHide',
      'keyboardWillChangeFrame', 'keyboardDidChangeFrame'] as const;
    const subscriptions = events.map(name => Keyboard.addListener(name, (event: KeyboardEvent) => {
      if (!focus.current) return;
      record(name, route, { ...dimensions(), appState: AppState.currentState, rnVisible: Keyboard.isVisible(),
        focused: focus.current, screenX: event.endCoordinates?.screenX, screenY: event.endCoordinates?.screenY,
        width: event.endCoordinates?.width, height: event.endCoordinates?.height, duration: event.duration,
        startScreenY: 'startCoordinates' in event ? event.startCoordinates?.screenY : undefined,
        startHeight: 'startCoordinates' in event ? event.startCoordinates?.height : undefined,
        isEventFromThisApp: 'isEventFromThisApp' in event ? event.isEventFromThisApp : undefined });
      schedule();
    }));
    const app = AppState.addEventListener('change', appState => {
      if (!focus.current) return;
      record('app-state', route, { appState, ...dimensions(), rnVisible: Keyboard.isVisible() });
      sample(0); flush();
      if (appState === 'active') schedule();
    });
    const size = Dimensions.addEventListener('change', () => { if (focus.current) schedule(); });
    schedule();
    return () => {
      alive = false; timers.forEach(clearTimeout); subscriptions.forEach(subscription => subscription.remove());
      app.remove(); size.remove(); record('unmount', route); flush();
    };
  }, [route]);
  const onLayout = (event: LayoutChangeEvent) => {
    const kav = ref.current;
    const bottom = (kav?.state as { bottom?: number } | undefined)?.bottom;
    if (focus.current) record('layout', route, { part: 'form', ...event.nativeEvent.layout,
      storedBottom: bottom, paddingBottom: kav?.props.enabled === false ? 0 : bottom });
  };
  const onEditorLayout = (part: string, event: LayoutChangeEvent) => {
    if (focus.current) record('layout', route, { part, ...event.nativeEvent.layout });
  };
  return { ref, onLayout, onEditorLayout,
    onState: (data: Record<string, unknown>) => { if (focus.current) record('form-state', route, data); } };
}
export function KeyboardCaptureButton({ route }: { route: ReportRoute }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const start = (keyboard: KeyboardKind) => {
    load(); report.reset(keyboard); record('issue-marker', route); flush();
    setNotice(storageFailed ? 'Could not save the report on this device.' : 'Recording started. Close this panel and repeat the problem.');
  };
  const share = async () => {
    if (busy) return;
    setBusy(true); setNotice('');
    record('report-share', route); flush();
    try {
      if (Platform.OS === 'ios') {
        if (storageFailed) throw new Error('local report write failed');
        // Freeze the export: opening the share sheet can itself emit AppState
        // and keyboard events, which must not rewrite the file being shared.
        const exported = new File(Paths.cache, 'hermes-keyboard-export.json');
        exported.write(JSON.stringify(report.snapshot(), null, 2));
        await Share.share({ url: exported.uri }, { subject: 'Hermes keyboard report' });
      } else await Share.share({ message: JSON.stringify(report.snapshot(), null, 2) });
    } catch { setNotice('Could not share the report. Try again.'); }
    finally { setBusy(false); }
  };
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="Keyboard report" onPress={() => {
      record('report-open', route); setNotice(''); setOpen(true);
    }} style={s.header}><Text style={s.link}>Report</Text></Pressable>
    <Modal visible={open} animationType="none" transparent onRequestClose={() => setOpen(false)}>
      <View style={s.backdrop}><View style={s.panel}>
        <Text style={s.title}>Keyboard report</Text>
        <Text style={s.body}>{KEYBOARD_REPORT_BUILD}</Text>
        <Text style={s.body}>Temporary recording of keyboard events and layout sizes only. No typed text, messages, attachments, or account details are collected. Reports stay on this device until you share them.</Text>
        <Text style={s.body}>Choose your keyboard to start a fresh recording. Close this panel, open the keyboard, switch away and return. Wait for the problem, then open Report and share.</Text>
        {(['system-english', 'system-chinese', 'third-party'] as const).map((kind, index) =>
          <Pressable key={kind} accessibilityRole="button" onPress={() => {
            Alert.alert('Start a new recording?', 'This replaces the previous keyboard report, not your draft.',
              [{ text: 'Cancel', style: 'cancel' }, { text: 'Start', onPress: () => start(kind) }]);
          }} style={s.action}><Text>{['System English', 'System Chinese', 'Third-party keyboard'][index]}</Text></Pressable>)}
        {!!notice && <Text accessibilityRole="alert" style={s.body}>{notice}</Text>}
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void share()} style={s.action}><Text>{busy ? 'Sharing…' : 'Share report'}</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={s.action}><Text>Close</Text></Pressable>
      </View></View>
    </Modal>
  </>;
}
const s = StyleSheet.create({
  header: { paddingHorizontal: 10, paddingVertical: 8 }, link: { color: '#2b4e81', fontSize: 14 },
  backdrop: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,0.35)' },
  panel: { backgroundColor: '#f8fafc', borderRadius: 12, padding: 18, gap: 10 },
  title: { fontSize: 19, fontWeight: '600', color: '#172a40' }, body: { fontSize: 13, color: '#42566c' },
  action: { backgroundColor: '#e7eef8', borderRadius: 8, padding: 12, minHeight: 44 },
});
