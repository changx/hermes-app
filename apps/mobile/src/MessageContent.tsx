import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { parseMessageMarkdown } from './messageMarkdown';
import type { Block, Inline, TableCell } from './messageMarkdown';

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
      case 'image': return null; // Images are split out before entering native Text.
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

type Segment = { kind: 'text'; nodes: Inline[] } | { kind: 'image'; image: Extract<Inline, { kind: 'image' }> };

// Text cannot contain a native View/Image. Split at images, including those
// inside emphasis or links, while retaining the formatting of adjacent runs.
function segments(nodes: Inline[]): Segment[] {
  const result: Segment[] = [];
  const append = (node: Inline) => {
    const last = result[result.length - 1];
    if (last?.kind === 'text') last.nodes.push(node);
    else result.push({ kind: 'text', nodes: [node] });
  };
  for (const node of nodes) {
    if (node.kind === 'image') result.push({ kind: 'image', image: node });
    else if ('children' in node) {
      for (const part of segments(node.children)) {
        if (part.kind === 'image') result.push(part);
        else append({ ...node, children: part.nodes });
      }
    } else append(node);
  }
  return result;
}

function ImagePreview({ image }: { image: Extract<Inline, { kind: 'image' }> }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const label = image.text || '未命名图片';
  const caption = !image.src ? `图片不可用：${label}` : status === 'error' ? `图片加载失败，点按重试：${label}`
    : status === 'loading' ? `图片加载中：${label}` : status === 'loaded' ? `图片：${label}` : `加载图片：${label}`;
  return <Pressable accessibilityRole={!image.src || status === 'loaded' ? 'image' : 'button'} accessibilityLabel={caption}
    disabled={!image.src || status === 'loading' || status === 'loaded'} style={styles.imageFrame}
    onPress={() => setStatus('loading')}>
    {image.src && (status === 'loading' || status === 'loaded') &&
      <Image source={{ uri: image.src }} accessibilityLabel={label} style={styles.image}
        resizeMode="contain" onLoad={() => setStatus('loaded')} onError={() => setStatus('error')} />}
    {status !== 'loaded' && <Text style={styles.imageLabel}>{caption}</Text>}
  </Pressable>;
}

function RichText({ nodes, tone, style }: { nodes: Inline[]; tone: Tone; style: object }) {
  return <View style={styles.richText}>{segments(nodes).map((part, index) => part.kind === 'image'
    ? <ImagePreview key={index} image={part.image} />
    : <Animated.Text key={index} selectable style={[style, tone('#172a40')]}>
        <InlineText nodes={part.nodes} tone={tone} />
      </Animated.Text>)}</View>;
}

function Cell({ cell, header, tone }: { cell: TableCell; header: boolean; tone: Tone }) {
  return <View style={[styles.tableCell, header && styles.tableHeadCell]}>
    <View style={[styles.cellContent, cell.align === 'center' && styles.alignCenter, cell.align === 'right' && styles.alignRight]}>
      <RichText nodes={cell.children} tone={tone} style={header ? styles.tableHeadText : styles.paragraph} />
    </View>
  </View>;
}

function RenderBlock({ block, tone }: { block: Block; tone: Tone }) {
  switch (block.kind) {
    case 'paragraph':
      return <RichText nodes={block.children} tone={tone} style={styles.paragraph} />;
    case 'heading':
      return <RichText nodes={block.children} tone={tone} style={[styles.heading, block.level === 1 ? styles.h1 : block.level === 2 ? styles.h2 : block.level === 3 ? styles.h3 : block.level === 4 ? styles.h4 : block.level === 5 ? styles.h5 : styles.h6]} />;
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
          {block.checks[index] !== null
            ? <View style={styles.bullet} accessibilityRole="checkbox" accessibilityState={{ checked: block.checks[index], disabled: true }}
                accessibilityLabel={block.checks[index] ? '已完成' : '未完成'}>
                <Animated.Text style={tone('#425874')}>{block.checks[index] ? '☑' : '☐'}</Animated.Text>
              </View>
            : <Animated.Text style={[styles.bullet, tone('#425874')]}>{block.ordered ? `${block.start + index}.` : '•'}</Animated.Text>}
          <View style={styles.listBody}><RenderBlocks blocks={item} tone={tone} /></View>
        </View>)}</View>;
    case 'table':
      return <View style={styles.tableFrame}>
        <ScrollView horizontal nestedScrollEnabled style={styles.tableScroll} showsHorizontalScrollIndicator>
          <View style={styles.tableBody}>
            <View style={styles.tableRow}>{block.header.map((cell, i) => <Cell key={i} cell={cell} header tone={tone} />)}</View>
            {block.rows.map((row, i) => <View key={i} style={styles.tableRow}>
              {row.map((cell, j) => <Cell key={j} cell={cell} header={false} tone={tone} />)}
            </View>)}
          </View>
        </ScrollView>
      </View>;
    case 'rule': return <View style={styles.rule} />;
  }
}

function RenderBlocks({ blocks, tone }: { blocks: Block[]; tone: Tone }) {
  return <View style={styles.blocks}>{blocks.map((block, index) => <RenderBlock key={index} block={block} tone={tone} />)}</View>;
}

/** Native renderer: remote images only load after the user taps. */
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
  h1: { fontSize: 21, lineHeight: 28 }, h2: { fontSize: 18, lineHeight: 26 },
  h3: { fontSize: 17, lineHeight: 25 }, h4: { fontSize: 16, lineHeight: 24 }, h5: { fontSize: 15, lineHeight: 23 }, h6: { fontSize: 14, lineHeight: 22 },
  strong: { fontWeight: '700' }, em: { fontStyle: 'italic' }, strike: { textDecorationLine: 'line-through' },
  link: { color: '#215ca7', textDecorationLine: 'underline' },
  inlineCode: { fontFamily: 'monospace', backgroundColor: '#edf2f7', color: '#20314a', fontSize: 14 },
  richText: { minWidth: 0 },
  imageFrame: { width: '100%', maxWidth: 280, height: 168, borderWidth: 1, borderRadius: 8, borderColor: '#d6e0ed', backgroundColor: '#f2f5fa', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  imageLabel: { color: '#52657c', fontSize: 13, textAlign: 'center', padding: 10 },
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
  tableFrame: { width: '100%', minWidth: 0, maxWidth: '100%', overflow: 'hidden', borderWidth: 1, borderColor: '#d6e0ed', borderRadius: 6 },
  tableScroll: { width: '100%', maxWidth: '100%' },
  tableBody: { alignSelf: 'flex-start' },
  tableRow: { flexDirection: 'row' },
  tableCell: { width: 156, borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#d6e0ed', padding: 8 },
  tableHeadCell: { backgroundColor: '#e5ecf5' },
  tableHeadText: { fontSize: 15, lineHeight: 23, fontWeight: '700' },
  cellContent: { minWidth: 0 },
  alignCenter: { alignItems: 'center' }, alignRight: { alignItems: 'flex-end' },
  copyMessage: { alignSelf: 'flex-end', paddingTop: 7, paddingBottom: 2 },
  copyMessageText: { color: '#526d91', fontSize: 12 },
});
