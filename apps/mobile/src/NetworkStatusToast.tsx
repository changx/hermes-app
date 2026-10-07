import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ConnectionState } from '../../../packages/client/src/index';
import { Text } from './FontSize';

export function networkStatusText(state: ConnectionState, retryAt: number | null, now: number, failed: boolean): string | null {
  if (state === 'online') return null;
  if (state === 'blocked') return 'This device is not authorized to connect.';
  if (state === 'suspended') return failed ? 'Connection could not be restored.' : null;
  if (state === 'syncing') return 'Restoring connection…';
  if (state === 'connecting') return 'Connecting…';
  const seconds = retryAt === null ? 0 : Math.max(0, Math.ceil((retryAt - now) / 1000));
  return seconds > 0 ? `Connection interrupted. Retrying in ${seconds}s…` : 'Retrying connection…';
}

/** Account-wide information only. Never intercept input or ask for a retry.
 * With several connections, `source` names the connection the status is about. */
export function NetworkStatusToast({ state, retryAt, failed = false, source }: { state: ConnectionState; retryAt: number | null; failed?: boolean; source?: string }) {
  const insets = useSafeAreaInsets();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (state !== 'retrying' || retryAt === null) return;
    // Wake only when the shown whole second changes, not several times a second.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const left = retryAt - Date.now();
      if (left <= 0) return;
      const delay = left % 1000 || 1000;
      timer = setTimeout(() => { setNow(Date.now()); schedule(); }, delay);
    };
    schedule();
    return () => { if (timer !== undefined) clearTimeout(timer); };
  }, [state, retryAt]);
  const status = networkStatusText(state, retryAt, now, failed);
  if (!status) return null;
  const text = source ? `${source}: ${status}` : status;
  const announcement = state === 'retrying' ? `${source ? source + ': ' : ''}Connection interrupted. Retrying automatically.` : text;
  return <View pointerEvents="none" style={[styles.position, { top: insets.top + 8 }]}>
    <View accessible accessibilityRole="text" accessibilityLiveRegion="polite" accessibilityLabel={announcement} style={styles.toast}>
      <Text accessible={false} style={styles.text}>{text}</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  position: { position: 'absolute', left: 16, right: 16, zIndex: 1000, elevation: 20, alignItems: 'center' },
  toast: { maxWidth: '100%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: '#334155' },
  text: { fontSize: 14, color: '#ffffff', textAlign: 'center' },
});
