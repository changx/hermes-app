import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Text } from './FontSize';
import { SessionOpenMeasurement, timingReport, type TimingResult } from './sessionTiming';
import { SESSION_TIMING_AVAILABLE, isSessionTimingEnabled, setSessionTimingEnabled } from './sessionTimingSwitch';

export function SessionTimingControl() {
  const [enabled, setEnabled] = useState(isSessionTimingEnabled);
  if (!SESSION_TIMING_AVAILABLE) return null;
  return <Pressable accessibilityRole="switch" accessibilityState={{ checked: enabled }} onPress={() => { setSessionTimingEnabled(!enabled); setEnabled(!enabled); }}>
    <Text>Temporary session timing: {enabled ? 'On' : 'Off'}</Text>
  </Pressable>;
}

export function SessionTimingPanel({ measurement, active }: { measurement: SessionOpenMeasurement | null; active: boolean }) {
  const [result, setResult] = useState<TimingResult | null>(measurement?.result ?? null);
  const [details, setDetails] = useState(false), [hidden, setHidden] = useState(false), [copyState, setCopyState] = useState('');
  useEffect(() => {
    setResult(measurement?.result ?? null);
    return measurement?.subscribe(setResult);
  }, [measurement]);
  if (!measurement || !active || hidden) return null;
  const report = result ? timingReport(result) : 'Measuring this page’s first opening…';
  const summary = report.split('\n').filter(line => line.startsWith('Total') || line.startsWith('History ready to') || line.startsWith('After UI release') || line.startsWith('Most elapsed') || line.startsWith('Empty conversation'));
  return <View style={styles.overlay} pointerEvents="box-none">
    <View style={styles.badge}>
      <Text style={styles.label}>Temporary timing · first opening{result ? ` · ${result.outcome}` : ''}</Text>
      {result ? summary.map(line => <Text key={line} style={styles.line}>{line}</Text>) : <Text style={styles.line}>{report}</Text>}
      <View style={styles.buttons}>
        {result && <Pressable accessibilityRole="button" accessibilityLabel="Show timing details" onPress={() => setDetails(true)}><Text>Details</Text></Pressable>}
        <Pressable accessibilityRole="button" accessibilityLabel="Hide timing result" onPress={() => setHidden(true)}><Text>Hide</Text></Pressable>
      </View>
    </View>
    <Modal visible={details && active} transparent animationType="none" onRequestClose={() => setDetails(false)}>
      <View style={styles.backdrop}><View style={styles.dialog}>
        <ScrollView><Text selectable>{report}</Text></ScrollView>
        <View style={styles.buttons}>
          <Pressable accessibilityRole="button" accessibilityLabel="Copy timing result" onPress={() => { void Clipboard.setStringAsync(report).then(() => setCopyState('Copied'), () => setCopyState('Copy failed')); }}><Text>Copy result</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Close timing details" onPress={() => setDetails(false)}><Text>Close</Text></Pressable>
        </View><Text>{copyState}</Text>
      </View></View>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 8, left: 12, right: 12, zIndex: 100 },
  badge: { backgroundColor: '#fffbe8', padding: 10, borderWidth: 1, borderColor: '#d4c788', borderRadius: 8 },
  label: { fontWeight: '600', fontSize: 12 }, line: { fontSize: 11 },
  buttons: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8 },
  backdrop: { flex: 1, backgroundColor: '#0006', justifyContent: 'center', padding: 20 },
  dialog: { backgroundColor: 'white', padding: 16, borderRadius: 10, maxHeight: '80%' },
});
