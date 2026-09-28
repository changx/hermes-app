import React, { createContext, forwardRef, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text as NativeText, TextInput as NativeTextInput, View } from 'react-native';
import type { TextInputProps, TextProps, TextStyle } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { safeFontScale } from './fontScale';

export const FONT_SIZE_KEY = 'hermes.interface_font_size.v1';
export const FONT_SIZES = { Small: 1, Default: 1.1, Large: 1.15, 'Extra large': 1.3 } as const;
export type FontSizeChoice = keyof typeof FONT_SIZES;
export function validFontSize(value: unknown): FontSizeChoice {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FONT_SIZES, value) ? value as FontSizeChoice : 'Default';
}

// Whitelist the only accepted multipliers before interpolating into WebView CSS.
export { safeFontScale } from './fontScale';

export function scaledTextStyle(style: TextProps['style'] | TextInputProps['style'], scale: number, nested = false): TextStyle | undefined {
  const flattened = StyleSheet.flatten(style) as TextStyle | undefined;
  const multiplier = safeFontScale(scale);
  if (multiplier === 1) return flattened;
  const fontSize = flattened?.fontSize;
  const lineHeight = flattened?.lineHeight;
  // A nested Text without an explicit size already inherits its parent's scaled size.
  // Root text without an explicit size needs a size to scale the native default.
  const baseline = Platform.OS === 'ios' ? 17 : 14;
  return {
    ...flattened,
    ...(!nested || typeof fontSize === 'number' ? { fontSize: (typeof fontSize === 'number' ? fontSize : baseline) * multiplier } : {}),
    ...(typeof lineHeight === 'number' ? { lineHeight: lineHeight * multiplier } : {}),
  };
}

type FontContextValue = {
  choice: FontSizeChoice;
  scale: number;
  loading: boolean;
  saving: boolean;
  error: string | null;
  select: (choice: FontSizeChoice) => Promise<void>;
};
const FontContext = createContext<FontContextValue>({ choice: 'Default', scale: FONT_SIZES.Default, loading: false, saving: false, error: null, select: async () => {} });
const NestedText = createContext(false);
export const useFontSize = () => useContext(FontContext);

export function FontSizeProvider({ children }: { children: React.ReactNode }) {
  const [choice, setChoice] = useState<FontSizeChoice>('Default');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const restoreGeneration = useRef(0);
  const revision = useRef(0);
  const confirmed = useRef<FontSizeChoice>('Default');
  const writes = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    mounted.current = true;
    const atStart = ++revision.current;
    const generation = ++restoreGeneration.current;
    SecureStore.getItemAsync(FONT_SIZE_KEY).then(raw => {
      if (!mounted.current || revision.current !== atStart) return;
      const restored = validFontSize(raw);
      confirmed.current = restored;
      setChoice(restored);
      if (raw !== null && restored === 'Default' && raw !== 'Default') setError('Saved font size was not recognized. Using Default.');
    }).catch(() => {
      if (mounted.current && revision.current === atStart) setError('Could not load font size. Using Default.');
    }).finally(() => { if (mounted.current && restoreGeneration.current === generation) setLoading(false); });
    // In StrictMode a stale first mount's read must not update the second mount.
    return () => { mounted.current = false; ++revision.current; ++restoreGeneration.current; };
  }, []);
  const select = useCallback((next: FontSizeChoice): Promise<void> => {
    if (!Object.prototype.hasOwnProperty.call(FONT_SIZES, next)) return Promise.resolve();
    const current = ++revision.current;
    setChoice(next); // immediate preview; only a successful write is confirmed
    setSaving(true);
    setError(null);
    const save = writes.current.then(() => SecureStore.setItemAsync(FONT_SIZE_KEY, next));
    writes.current = save.catch(() => {}); // serialize overlapping SecureStore writes
    return save.then(() => {
      confirmed.current = next;
      if (mounted.current && revision.current === current) setSaving(false);
    }).catch(() => {
      if (mounted.current && revision.current === current) {
        setChoice(confirmed.current);
        setSaving(false);
        setError('Could not save font size. Your previous choice is still in use.');
      }
    });
  }, []);
  const value = useMemo(() => ({ choice, scale: FONT_SIZES[choice], loading, saving, error, select }), [choice, loading, saving, error, select]);
  // Do not briefly display the app with Default before a saved size is restored.
  return <FontContext.Provider value={value}>{loading
    ? <View style={styles.restore}><NativeText>Loading interface…</NativeText></View>
    : children}</FontContext.Provider>;
}

export const Text = forwardRef<React.ElementRef<typeof NativeText>, TextProps>(function Text({ style, children, ...props }, ref) {
  const { scale } = useFontSize();
  const nested = useContext(NestedText);
  return <NativeText ref={ref} {...props} style={scaledTextStyle(style, scale, nested)}>
    <NestedText.Provider value={true}>{children}</NestedText.Provider>
  </NativeText>;
});

export const TextInput = forwardRef<React.ElementRef<typeof NativeTextInput>, TextInputProps>(function TextInput({ style, ...props }, ref) {
  const { scale } = useFontSize();
  return <NativeTextInput ref={ref} {...props} style={scaledTextStyle(style, scale)} />;
});

// Animated message colors remain native-driven; the wrapped text alone owns sizing.
export const AnimatedText = Animated.createAnimatedComponent(Text);

export function FontSizeSettings() {
  const { choice, loading, saving, error, select } = useFontSize();
  return <View style={styles.container}>
    <Text style={styles.label}>Interface font size</Text>
    <Text style={styles.preview}>Preview: Read your conversations comfortably.</Text>
    <View style={styles.options}>{(Object.keys(FONT_SIZES) as FontSizeChoice[]).map(option =>
      <Pressable key={option} accessibilityRole="radio" accessibilityState={{ selected: choice === option, disabled: loading }}
        disabled={loading} onPress={() => { void select(option); }} style={[styles.option, choice === option && styles.selected]}>
        <Text style={[styles.optionText, choice === option && styles.selectedText]}>{option}</Text>
      </Pressable>)}</View>
    {loading && <Text style={styles.hint}>Loading font size…</Text>}
    {saving && <Text style={styles.hint}>Saving font size…</Text>}
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  restore: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { gap: 8, paddingVertical: 12 },
  label: { color: '#172a40', fontWeight: '700', fontSize: 15 },
  preview: { color: '#42566f', fontSize: 15, lineHeight: 23 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  option: { borderWidth: 1, borderColor: '#bac8db', borderRadius: 8, paddingVertical: 9, paddingHorizontal: 10, minHeight: 42, justifyContent: 'center' },
  selected: { borderColor: '#2960ad', backgroundColor: '#e6f0ff' },
  optionText: { color: '#42566f', fontSize: 13 },
  selectedText: { color: '#215ca7', fontWeight: '700' },
  hint: { color: '#607187', fontSize: 12 },
  error: { color: '#9d1b32', fontSize: 12 },
});
