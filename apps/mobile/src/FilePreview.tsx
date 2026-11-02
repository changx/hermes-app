import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { File } from 'expo-file-system';
import { useVideoPlayer, VideoView } from 'expo-video';
import WebView from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './FontSize';
import { MessageContent } from './MessageContent';
import { openLink } from './openLink';
import { PREVIEW_MARKDOWN_BYTES, PREVIEW_MAX_BYTES, PREVIEW_TEXT_BYTES, type PreviewKind } from './filePreviewKind';
import { fileSize } from './nativeNumber';

/** `onZoom` reports when the image is larger than the page, so a gallery can stop paging. */
export function ImageViewer({ uri, width: pageWidth, onZoom }: { uri: string; width?: number; onZoom?: (zoomed: boolean) => void }) {
  const window = useWindowDimensions(), width = pageWidth ?? window.width, height = window.height;
  const insets = useSafeAreaInsets();
  const [scale, setScale] = useState(1);
  const zoomed = useRef(false);
  const report = (next: boolean) => { if (zoomed.current !== next) { zoomed.current = next; onZoom?.(next); } };
  useEffect(() => { if (Platform.OS !== 'ios') report(scale > 1); }, [scale]);
  return <View style={styles.dark}>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.zoomContent} minimumZoomScale={1} maximumZoomScale={4} centerContent
      scrollEventThrottle={32} onScroll={Platform.OS === 'ios' ? event => report((event.nativeEvent.zoomScale ?? 1) > 1.01) : undefined}>
      <Image source={{ uri }} resizeMode="contain" style={{ width: width * scale, height: (height - insets.top - insets.bottom - 70) * scale }} />
    </ScrollView>
    {Platform.OS !== 'ios' && <View style={styles.controls}>
      <Pressable accessibilityRole="button" accessibilityLabel="Zoom out" style={styles.action} onPress={() => setScale(Math.max(1, scale / 1.5))}><Text style={styles.actionText}>Zoom out</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Zoom in" style={styles.action} onPress={() => setScale(Math.min(4, scale * 1.5))}><Text style={styles.actionText}>Zoom in</Text></Pressable>
    </View>}
  </View>;
}

function Notice({ text }: { text: string }) {
  return <View style={styles.page}><Text style={styles.notice}>{text}</Text></View>;
}

// iOS WKWebView renders PDF and Office/iWork/RTF files natively. JavaScript is off,
// the view can read only this file, and every other navigation is refused.
function NativeDocument({ uri }: { uri: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Notice text="Could not open this file. Go back and try again." />;
  return <WebView style={styles.white} source={{ uri }} originWhitelist={['file://*']} allowingReadAccessToURL={uri}
    javaScriptEnabled={false} startInLoadingState renderLoading={() => <ActivityIndicator style={StyleSheet.absoluteFill} />}
    onShouldStartLoadWithRequest={request => request.url === uri} onError={() => setFailed(true)} onContentProcessDidTerminate={() => setFailed(true)} />;
}

// Generated HTML runs as an untrusted page with an opaque origin: no file access,
// no storage shared with other previews, and web links leave for the in-app browser.
function HtmlPage({ html }: { html: string }) {
  return <WebView style={styles.white} source={{ html }} originWhitelist={['*']} javaScriptEnabled incognito
    allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false} setSupportMultipleWindows={false}
    onShouldStartLoadWithRequest={request => {
      if (request.url === 'about:blank' || request.url.startsWith('data:')) return true;
      if (request.isTopFrame === false && /^https?:/i.test(request.url)) return true;
      if (/^https?:/i.test(request.url)) openLink(request.url);
      return false;
    }}
    onOpenWindow={event => { if (/^https?:/i.test(event.nativeEvent.targetUrl)) openLink(event.nativeEvent.targetUrl); }} />;
}

function MediaPlayer({ uri, audio, active }: { uri: string; audio: boolean; active: boolean }) {
  const player = useVideoPlayer(uri, instance => { instance.loop = false; });
  const focused = useIsFocused();
  const [failed, setFailed] = useState(false);
  useEffect(() => { if (!focused || !active) player.pause(); }, [focused, active, player]);
  useEffect(() => {
    const status = player.addListener('statusChange', ({ status: next }) => { if (next === 'error') setFailed(true); });
    const app = AppState.addEventListener('change', state => { if (state !== 'active') player.pause(); });
    return () => { status.remove(); app.remove(); };
  }, [player]);
  if (failed) return <Notice text={audio ? 'This audio file cannot be played.' : 'This video cannot be played.'} />;
  return <View style={styles.dark}>
    <VideoView player={player} nativeControls contentFit="contain" style={audio ? styles.audio : { flex: 1 }} />
  </View>;
}

function TextFile({ uri, kind }: { uri: string; kind: 'markdown' | 'text' | 'html' }) {
  const [state, setState] = useState<{ text: string; size: number } | 'error' | 'large' | null>(null);
  useEffect(() => {
    let active = true;
    const file = new File(uri);
    // Attachments can be 100 MiB; the text viewer reads the whole file into one string, so it stops at the preview limit.
    if (fileSize(file) > PREVIEW_MAX_BYTES) { setState('large'); return; }
    file.text().then(text => { if (active) setState({ text, size: fileSize(file) }); }, () => { if (active) setState('error'); });
    return () => { active = false; };
  }, [uri]);
  if (state === 'error') return <Notice text="Could not read this file. Go back and try again." />;
  if (state === 'large') return <Notice text="This file is too large to preview in the app." />;
  if (!state) return <View style={styles.page}><ActivityIndicator /></View>;
  if (kind === 'html') return <HtmlPage html={state.text} />;
  if (!state.text) return <Notice text="This file is empty." />;
  if (kind === 'markdown' && state.size <= PREVIEW_MARKDOWN_BYTES) {
    return <ScrollView style={styles.white} contentContainerStyle={styles.content}><MessageContent text={state.text} /></ScrollView>;
  }
  const cut = state.text.length > PREVIEW_TEXT_BYTES;
  return <ScrollView style={styles.white} contentContainerStyle={styles.content}>
    <Text selectable style={styles.mono}>{cut ? state.text.slice(0, PREVIEW_TEXT_BYTES) : state.text}</Text>
    {cut && <Text style={styles.notice}>Only the first part of this file is shown.</Text>}
  </ScrollView>;
}

/** One viewer for every supported type. `uri` is a private local copy whose name keeps the original extension. */
export function FilePreview({ uri, kind, active = true, width, onZoom }: { uri: string; kind: PreviewKind; active?: boolean; width?: number; onZoom?: (zoomed: boolean) => void }) {
  switch (kind) {
    case 'image': return <ImageViewer uri={uri} width={width} onZoom={onZoom} />;
    case 'pdf': case 'document':
      return Platform.OS === 'ios' ? <NativeDocument uri={uri} />
        : <Notice text={kind === 'pdf' ? 'PDF preview is not available on this device yet.' : 'This document cannot be previewed on this device yet.'} />;
    case 'markdown': case 'text': case 'html': return <TextFile uri={uri} kind={kind} />;
    case 'video': case 'audio': return <MediaPlayer uri={uri} audio={kind === 'audio'} active={active} />;
    default: return <Notice text="This file type cannot be opened in the app yet." />;
  }
}

const styles = StyleSheet.create({
  dark: { flex: 1, backgroundColor: '#101722' }, white: { flex: 1, backgroundColor: '#fff' },
  page: { flex: 1, backgroundColor: '#fff', padding: 20 }, content: { padding: 16, paddingBottom: 40 },
  zoomContent: { alignItems: 'center', justifyContent: 'center', flexGrow: 1 },
  controls: { flexDirection: 'row', gap: 7, padding: 10 },
  action: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: '#e6f0ff' }, actionText: { color: '#215ca7', fontSize: 12 },
  audio: { height: 120, marginTop: 'auto', marginBottom: 'auto' },
  notice: { color: '#50647b', fontSize: 15, lineHeight: 22, marginTop: 12 },
  mono: { color: '#172a40', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 14, lineHeight: 20 },
});
