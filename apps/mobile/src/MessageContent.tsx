import React, { memo, useEffect, useMemo, useRef } from 'react';
import { AccessibilityInfo, Animated, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { parseMessageMarkdown } from './messageMarkdown';
import type { Block, Inline } from './messageMarkdown';

const copy = (value: string) => {
  void Clipboard.setStringAsync(value).catch(() => Alert.alert('复制失败', '无法写入剪贴板'));
};

type Tone = (color: string) => { color: Animated.AnimatedInterpolation<string> };

function InlineText({ nodes, tone }: { nodes: Inline[]; tone: Tone }) {
  return <>{nodes.map((node, index) => {
    const key = index;
    switch (node.kind) {
      case 'text': return <React.Fragment key={key}>{node.text}</React.Fragment>;
      case 'break': return <React.Fragment key={key}>{'\n'}</React.Fragment>;
      case 'code': return <Animated.Text key={key} style={[styles.inlineCode, tone('#20314a')]}>{node.text}</Animated.Text>;
      case 'image': return <Animated.Text key={key} style={[styles.imageLabel, tone('#607187')]}>[图片：{node.text || '未命名'}]</Animated.Text>;
      case 'em': return <Animated.Text key={key} style={styles.em}><InlineText nodes={node.children} tone={tone} /></Animated.Text>;
      case 'strong': return <Animated.Text key={key} style={styles.strong}><InlineText nodes={node.children} tone={tone} /></Animated.Text>;
      case 'strike': return <Animated.Text key={key} style={styles.strike}><InlineText nodes={node.children} tone={tone} /></Animated.Text>;
      case 'link': return node.href
        ? <Animated.Text key={key} accessibilityRole="link" style={[styles.link, tone('#215ca7')]}
            onPress={() => { void Linking.openURL(node.href!).catch(() => Alert.alert('链接无法打开')); }}>
            <InlineText nodes={node.children} tone={tone} />
          </Animated.Text>
        : <Animated.Text key={key}><InlineText nodes={node.children} tone={tone} /></Animated.Text>;
    }
  })}</>;
}

function RenderBlock({ block, tone }: { block: Block; tone: Tone }) {
  switch (block.kind) {
    case 'paragraph':
      return <Animated.Text selectable style={[styles.paragraph, tone('#172a40')]}><InlineText nodes={block.children} tone={tone} /></Animated.Text>;
    case 'heading':
      return <Animated.Text selectable style={[styles.heading, block.level === 1 ? styles.h1 : block.level === 2 ? styles.h2 : styles.hOther, tone('#172a40')]}><InlineText nodes={block.children} tone={tone} /></Animated.Text>;
    case 'code':
      return <View style={styles.codeBox}>
        <View style={styles.codeHeader}>
          <Text style={styles.codeLanguage} numberOfLines={1}>{block.language || '代码'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="复制代码" hitSlop={8} onPress={() => copy(block.text)}>
            <Text style={styles.copyCode}>复制代码</Text>
          </Pressable>
        </View>
        <ScrollView horizontal nestedScrollEnabled style={styles.codeScroll} showsHorizontalScrollIndicator>
          <Animated.Text selectable style={[styles.codeText, tone('#20314a')]}>{block.text || ' '}</Animated.Text>
        </ScrollView>
      </View>;
    case 'quote':
      return <View style={styles.quote}><RenderBlocks blocks={block.children} tone={tone} /></View>;
    case 'list':
      return <View style={styles.list}>{block.items.map((item, index) =>
        <View key={index} style={styles.listRow}>
          <Animated.Text style={[styles.bullet, tone('#425874')]}>{block.ordered ? `${block.start + index}.` : '•'}</Animated.Text>
          <View style={styles.listBody}><RenderBlocks blocks={item} tone={tone} /></View>
        </View>)}</View>;
    case 'rule': return <View style={styles.rule} />;
  }
}

function RenderBlocks({ blocks, tone }: { blocks: Block[]; tone: Tone }) {
  return <View style={styles.blocks}>{blocks.map((block, index) => <RenderBlock key={index} block={block} tone={tone} />)}</View>;
}

/** Pure native text renderer: no HTML, WebView, or remote image requests. */
export const MessageContent = memo(function MessageContent({ text, pending = false }: { text: string; pending?: boolean }) {
  const parsed = useMemo(() => parseMessageMarkdown(text), [text]);
  const progress = useRef(new Animated.Value(pending ? 0 : 1)).current;
  const wasPending = useRef(pending);
  const reducedMotion = useRef(false);
  const currentPending = useRef(pending);
  currentPending.current = pending;
  useEffect(() => {
    let alive = true;
    const update = (value: boolean) => {
      reducedMotion.current = value;
      if (value) { progress.stopAnimation(); progress.setValue(currentPending.current ? 0 : 1); }
    };
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) update(value); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', update);
    return () => { alive = false; sub.remove(); progress.stopAnimation(); };
  }, [progress]);
  useEffect(() => {
    if (pending) { progress.stopAnimation(); progress.setValue(0); }
    else if (wasPending.current && !reducedMotion.current) {
      // Real acceptance starts this visual transition; it never delays sending.
      Animated.timing(progress, { toValue: 1, duration: 240, useNativeDriver: false }).start();
    } else progress.setValue(1);
    wasPending.current = pending;
  }, [pending, progress]);
  const tone: Tone = color => ({ color: progress.interpolate({ inputRange: [0, 1], outputRange: ['#93a0b0', color] }) });
  return <View style={styles.root}>
    <RenderBlocks blocks={parsed} tone={tone} />
    {!!text && <Pressable accessibilityRole="button" accessibilityLabel="复制整条消息" hitSlop={8}
      style={styles.copyMessage} onPress={() => copy(text)}><Text style={styles.copyMessageText}>复制消息</Text></Pressable>}
  </View>;
});

const styles = StyleSheet.create({
  root: { width: '100%', minWidth: 0 },
  blocks: { width: '100%', minWidth: 0, gap: 8 },
  paragraph: { color: '#172a40', fontSize: 15, lineHeight: 23, flexShrink: 1 },
  heading: { color: '#172a40', fontWeight: '700', flexShrink: 1 },
  h1: { fontSize: 21, lineHeight: 28 }, h2: { fontSize: 18, lineHeight: 26 }, hOther: { fontSize: 16, lineHeight: 24 },
  strong: { fontWeight: '700' }, em: { fontStyle: 'italic' }, strike: { textDecorationLine: 'line-through' },
  link: { color: '#215ca7', textDecorationLine: 'underline' },
  inlineCode: { fontFamily: 'monospace', backgroundColor: '#edf2f7', color: '#20314a', fontSize: 14 },
  imageLabel: { color: '#607187', fontStyle: 'italic' },
  quote: { borderLeftWidth: 3, borderLeftColor: '#9ab2d2', paddingLeft: 10, minWidth: 0 },
  list: { gap: 5, minWidth: 0 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', minWidth: 0 },
  bullet: { width: 26, flexShrink: 0, color: '#425874', fontSize: 15, lineHeight: 23 },
  listBody: { flex: 1, minWidth: 0 },
  rule: { height: 1, backgroundColor: '#d7e0eb', width: '100%' },
  codeBox: { width: '100%', minWidth: 0, borderRadius: 8, borderWidth: 1, borderColor: '#d6e0ed', backgroundColor: '#f2f5fa', overflow: 'hidden' },
  codeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, gap: 8, backgroundColor: '#e5ecf5' },
  codeLanguage: { color: '#52657c', fontSize: 12, flexShrink: 1 }, copyCode: { color: '#215ca7', fontSize: 12, fontWeight: '600' },
  codeScroll: { width: '100%', maxWidth: '100%' },
  codeText: { fontFamily: 'monospace', color: '#20314a', fontSize: 13, lineHeight: 19, padding: 10 },
  copyMessage: { alignSelf: 'flex-end', paddingTop: 7, paddingBottom: 2 },
  copyMessageText: { color: '#526d91', fontSize: 12 },
});
