import React, { memo, useMemo } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { parseMessageMarkdown } from './messageMarkdown';
import type { Block, Inline } from './messageMarkdown';

const copy = (value: string) => {
  void Clipboard.setStringAsync(value).catch(() => Alert.alert('复制失败', '无法写入剪贴板'));
};

function InlineText({ nodes }: { nodes: Inline[] }) {
  return <>{nodes.map((node, index) => {
    const key = index;
    switch (node.kind) {
      case 'text': return <React.Fragment key={key}>{node.text}</React.Fragment>;
      case 'break': return <React.Fragment key={key}>{'\n'}</React.Fragment>;
      case 'code': return <Text key={key} style={styles.inlineCode}>{node.text}</Text>;
      case 'image': return <Text key={key} style={styles.imageLabel}>[图片：{node.text || '未命名'}]</Text>;
      case 'em': return <Text key={key} style={styles.em}><InlineText nodes={node.children} /></Text>;
      case 'strong': return <Text key={key} style={styles.strong}><InlineText nodes={node.children} /></Text>;
      case 'strike': return <Text key={key} style={styles.strike}><InlineText nodes={node.children} /></Text>;
      case 'link': return node.href
        ? <Text key={key} accessibilityRole="link" style={styles.link}
            onPress={() => { void Linking.openURL(node.href!).catch(() => Alert.alert('链接无法打开')); }}>
            <InlineText nodes={node.children} />
          </Text>
        : <Text key={key}><InlineText nodes={node.children} /></Text>;
    }
  })}</>;
}

function RenderBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case 'paragraph':
      return <Text selectable style={styles.paragraph}><InlineText nodes={block.children} /></Text>;
    case 'heading':
      return <Text selectable style={[styles.heading, block.level === 1 ? styles.h1 : block.level === 2 ? styles.h2 : styles.hOther]}><InlineText nodes={block.children} /></Text>;
    case 'code':
      return <View style={styles.codeBox}>
        <View style={styles.codeHeader}>
          <Text style={styles.codeLanguage} numberOfLines={1}>{block.language || '代码'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="复制代码" hitSlop={8} onPress={() => copy(block.text)}>
            <Text style={styles.copyCode}>复制代码</Text>
          </Pressable>
        </View>
        <ScrollView horizontal nestedScrollEnabled style={styles.codeScroll} showsHorizontalScrollIndicator>
          <Text selectable style={styles.codeText}>{block.text || ' '}</Text>
        </ScrollView>
      </View>;
    case 'quote':
      return <View style={styles.quote}><RenderBlocks blocks={block.children} /></View>;
    case 'list':
      return <View style={styles.list}>{block.items.map((item, index) =>
        <View key={index} style={styles.listRow}>
          <Text style={styles.bullet}>{block.ordered ? `${block.start + index}.` : '•'}</Text>
          <View style={styles.listBody}><RenderBlocks blocks={item} /></View>
        </View>)}</View>;
    case 'rule': return <View style={styles.rule} />;
  }
}

function RenderBlocks({ blocks }: { blocks: Block[] }) {
  return <View style={styles.blocks}>{blocks.map((block, index) => <RenderBlock key={index} block={block} />)}</View>;
}

/** Pure native text renderer: no HTML, WebView, or remote image requests. */
export const MessageContent = memo(function MessageContent({ text }: { text: string }) {
  const parsed = useMemo(() => parseMessageMarkdown(text), [text]);
  return <View style={styles.root}>
    <RenderBlocks blocks={parsed} />
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
