import React, { useCallback, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { Text } from './FontSize';
import { APP_ICONS, appIconForNative, nativeIconName, type AppIconId } from './appIconChoices';

type AlternateIcons = {
  supportsAlternateIcons: boolean;
  getAppIconName(): string | null;
  setAlternateAppIcon(name: string | null): Promise<string | null>;
};

// expo-alternate-app-icons is native code. Expo Go does not include it, so the
// setting is hidden there instead of failing on import.
const native = requireOptionalNativeModule<AlternateIcons>('ExpoAlternateAppIcons');

const THUMBS: Record<AppIconId, number> = {
  mochi: require('../assets/app-icons/mochi-thumb.png'),
  bubble: require('../assets/app-icons/bubble-thumb.png'),
  orb: require('../assets/app-icons/orb-thumb.png'),
};

const readCurrent = (): AppIconId => {
  try { return appIconForNative(native?.getAppIconName()); } catch { return 'mochi'; }
};

/** The system is the source of truth for the current icon; nothing is stored by the app. */
export function useAppIcon() {
  const available = !!native?.supportsAlternateIcons;
  const [current, setCurrent] = useState<AppIconId>(() => available ? readCurrent() : 'mochi');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const select = useCallback(async (next: AppIconId) => {
    if (!native || pending.current) return;
    pending.current = true; setSaving(true); setError(null);
    try {
      await native.setAlternateAppIcon(nativeIconName(next));
      setCurrent(readCurrent());
    } catch {
      setCurrent(readCurrent());
      setError('Could not change the app icon. Your current icon is still in use.');
    } finally {
      pending.current = false; setSaving(false);
    }
  }, []);
  return { available, current, saving, error, select };
}

export function AppIconSettings() {
  const { current, saving, error, select } = useAppIcon();
  return <View style={styles.container}>
    <View accessibilityRole="radiogroup" style={styles.options}>{APP_ICONS.map(icon => {
      const selected = current === icon.id;
      return <Pressable key={icon.id} accessibilityRole="radio" accessibilityLabel={icon.label}
        accessibilityState={{ selected, disabled: saving }} disabled={saving || selected}
        onPress={() => { void select(icon.id); }} style={[styles.option, selected && styles.selected]}>
        <Image source={THUMBS[icon.id]} style={styles.thumb} accessibilityIgnoresInvertColors />
        <Text style={[styles.label, selected && styles.selectedText]}>{icon.label}</Text>
      </Pressable>;
    })}</View>
    {saving && <Text style={styles.hint}>Changing app icon…</Text>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  options: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  option: { flex: 1, alignItems: 'center', gap: 8, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#d5dde8' },
  selected: { borderColor: '#2960ad', borderWidth: 2, backgroundColor: '#e6f0ff' },
  thumb: { width: 64, height: 64, borderRadius: 14 },
  label: { fontSize: 14, color: '#42566f' },
  selectedText: { color: '#215ca7', fontWeight: '700' },
  hint: { color: '#607187', fontSize: 12 },
  error: { color: '#9d1b32', fontSize: 12 },
});
