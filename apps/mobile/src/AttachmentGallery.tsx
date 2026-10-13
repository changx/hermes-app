import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useNavigation } from 'expo-router';
import { File } from 'expo-file-system';
import { Text } from './FontSize';
import { FilePreview } from './FilePreview';
import { forgetFile, ownedFile } from './attachmentFiles';
import { previewSuffix, type PreviewKind } from './filePreviewKind';
import { galleryPage } from './gallerySequence';
import { useViewerTitle } from './Viewers';

/** `open` gives a local source file. The page copies it and deletes the copy when it leaves the window. */
export type GalleryItem = { key: string; title: string; open: () => Promise<{ uri: string; kind: PreviewKind } | undefined> };

function GalleryPage({ item, width, active, onZoom }: { item: GalleryItem; width: number; active: boolean; onZoom: (zoomed: boolean) => void }) {
  const [state, setState] = useState<{ uri: string; kind: PreviewKind } | 'loading' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true, copy: File | undefined;
    setState('loading');
    void (async () => {
      try {
        const source = await item.open();
        if (!alive || !source) return;
        copy = ownedFile(previewSuffix(item.title));
        await new File(source.uri).copy(copy);
        if (alive) setState({ uri: copy.uri, kind: source.kind }); else forgetFile(copy);
      } catch { if (alive) setState('error'); }
    })();
    return () => { alive = false; if (copy) forgetFile(copy); };
  }, [item, attempt]);
  return <View style={[styles.page, { width }]}>
    {state === 'loading' ? <View style={styles.center}><ActivityIndicator color="#fff" /></View>
      : state === 'error' ? <Pressable accessibilityRole="button" accessibilityLabel={`Retry: ${item.title}`} style={styles.center} onPress={() => setAttempt(value => value + 1)}>
        <Text style={styles.notice}>Could not open this file. Tap to try again.</Text>
      </Pressable>
      : <FilePreview uri={state.uri} kind={state.kind} active={active} width={width} onZoom={active ? onZoom : undefined} />}
  </View>;
}

/**
 * Attachments shown side by side: swipe left or right to move between them.
 * Only the current page and its neighbours stay mounted, so memory stays small.
 * A zoomed image keeps the swipe for panning until it is zoomed out.
 */
export function AttachmentGallery({ items, initialIndex }: { items: GalleryItem[]; initialIndex: number }) {
  const navigation = useNavigation();
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(() => Math.min(Math.max(0, initialIndex), Math.max(0, items.length - 1)));
  const [zoomed, setZoomed] = useState(false);
  const list = useRef<FlatList<GalleryItem>>(null), indexRef = useRef(index);
  indexRef.current = index;
  const count = items.length;
  useViewerTitle(items[index]?.title || 'Attachment');
  useEffect(() => {
    navigation.setOptions({
      headerRight: count > 1 ? () => <Text accessibilityLabel={`Attachment ${index + 1} of ${count}`} style={styles.counter}>{index + 1} / {count}</Text> : undefined,
    });
  }, [navigation, index, count]);
  // A rotation changes the page width: stay on the same attachment.
  useEffect(() => { if (width > 0) list.current?.scrollToOffset({ offset: indexRef.current * width, animated: false }); }, [width]);
  const settle = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = galleryPage(event.nativeEvent.contentOffset.x, width, count);
    if (next !== indexRef.current) { setZoomed(false); setIndex(next); }
  }, [width, count]);
  return <View style={styles.root} onLayout={event => { const next = Math.round(event.nativeEvent.layout.width); if (next > 0 && next !== width) setWidth(next); }}>
    {width > 0 && <FlatList ref={list} horizontal pagingEnabled data={items} keyExtractor={item => item.key} extraData={`${index}:${width}`}
      initialScrollIndex={index} getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
      initialNumToRender={1} maxToRenderPerBatch={1} windowSize={3} scrollEnabled={!zoomed} bounces={count > 1}
      showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" onMomentumScrollEnd={settle}
      renderItem={({ item, index: page }) => <GalleryPage item={item} width={width} active={page === index} onZoom={setZoomed} />} />}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#101722' },
  page: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  notice: { color: '#e6edf5', fontSize: 15, lineHeight: 22, textAlign: 'center' },
  counter: { color: '#50647b', fontSize: 15, fontVariant: ['tabular-nums'], paddingHorizontal: 4 },
});
