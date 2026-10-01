import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Alert, AppState, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AnimatedText, Text, useFontSize } from './FontSize';
import type { GestureResponderEvent } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useIsFocused } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import WebView from 'react-native-webview';
import { parseMessageMarkdown } from './messageMarkdown';
import { renderMarkdownHtml } from './markdownWeb';
import { ARTICLE_TEXT_LIMIT, renderArticleHtml } from './articleHtml';
import { safeLinkUrl } from './messageMarkdown';
import type { Block, Inline, TableCell } from './messageMarkdown';
import type { ToolCall } from '../../../packages/client/src/index';
import { compactFileDetail, toolDisplayLabel, toolPresentation } from '../../../packages/client/src/toolPresentation';
import { useViewer } from './Viewers';

const copy = (value: string) => {
  void Clipboard.setStringAsync(value).catch(() => Alert.alert('Copy failed', 'Could not copy to the clipboard.'));
};

type Tone = (color: string) => { color: Animated.AnimatedInterpolation<string> };
type ExpandTarget = { kind: 'message' } | { kind: 'table' | 'diagram'; block: Block };
type OpenExpand = (target: ExpandTarget) => void;
const stopTouch = (event: GestureResponderEvent) => event.stopPropagation();

function InlineText({ nodes, tone, onInteraction }: { nodes: Inline[]; tone: Tone; onInteraction: () => void }) {
  return <>{nodes.map((node, index) => {
    const key = index;
    switch (node.kind) {
      case 'text': return <React.Fragment key={key}>{node.text}</React.Fragment>;
      case 'break': return <React.Fragment key={key}>{'\n'}</React.Fragment>;
      case 'code': return <AnimatedText key={key} style={[styles.inlineCode, tone('#20314a')]}>{node.text}</AnimatedText>;
      case 'math': return <AnimatedText key={key} style={[styles.inlineCode, tone('#20314a')]}>{`$${node.text}$`}</AnimatedText>;
      case 'image': case 'video': return null; // Media is split out before Text.
      case 'em': return <AnimatedText key={key} style={styles.em}><InlineText nodes={node.children} tone={tone} onInteraction={onInteraction} /></AnimatedText>;
      case 'strong': return <AnimatedText key={key} style={styles.strong}><InlineText nodes={node.children} tone={tone} onInteraction={onInteraction} /></AnimatedText>;
      case 'strike': return <AnimatedText key={key} style={styles.strike}><InlineText nodes={node.children} tone={tone} onInteraction={onInteraction} /></AnimatedText>;
      case 'link': return node.href
        ? <AnimatedText key={key} accessibilityRole="link" style={[styles.link, tone('#215ca7')]}
            onPressIn={onInteraction}
            onPress={() => { onInteraction(); void Linking.openURL(node.href!).catch(() => Alert.alert('Could not open link')); }}>
            <InlineText nodes={node.children} tone={tone} onInteraction={onInteraction} />
          </AnimatedText>
        : <AnimatedText key={key}><InlineText nodes={node.children} tone={tone} onInteraction={onInteraction} /></AnimatedText>;
    }
  })}</>;
}

type Media = Extract<Inline, { kind: 'image' | 'video' }>;
type Segment = { kind: 'text'; nodes: Inline[] } | { kind: 'media'; media: Media } | { kind: 'math'; node: Extract<Inline, { kind: 'math' }> };

// Text cannot contain native media views. Split them even inside links/emphasis,
// while preserving the formatting of adjacent text runs.
function segments(nodes: Inline[]): Segment[] {
  const result: Segment[] = [];
  const append = (node: Inline) => {
    const last = result[result.length - 1];
    if (last?.kind === 'text') last.nodes.push(node);
    else result.push({ kind: 'text', nodes: [node] });
  };
  for (const node of nodes) {
    if (node.kind === 'image' || node.kind === 'video') result.push({ kind: 'media', media: node });
    else if (node.kind === 'math') result.push({ kind: 'math', node });
    else if ('children' in node) {
      for (const part of segments(node.children)) {
        if (part.kind !== 'text') result.push(part);
        else append({ ...node, children: part.nodes });
      }
    } else append(node);
  }
  return result;
}

function ImagePreview({ image }: { image: Extract<Inline, { kind: 'image' }> }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const label = image.text || 'Unnamed image';
  const caption = !image.src ? `Image unavailable: ${label}` : status === 'error' ? `Image failed to load. Tap to retry: ${label}`
    : status === 'loading' ? `Loading image: ${label}` : `Image: ${label}`;
  return <Pressable onTouchStart={stopTouch} accessibilityRole={!image.src || status === 'loaded' ? 'image' : 'button'} accessibilityLabel={caption}
    disabled={!image.src || status !== 'error'} style={styles.imageFrame}
    onPress={() => { setAttempt(value => value + 1); setStatus('loading'); }}>
    {image.src && status !== 'error' &&
      <Image key={attempt} source={{ uri: image.src }} accessibilityLabel={label} style={styles.image}
        resizeMode="contain" onLoad={() => setStatus('loaded')} onError={() => setStatus('error')} />}
    {status !== 'loaded' && <Text style={styles.imageLabel}>{caption}</Text>}
  </Pressable>;
}

function PlayingVideo({ src, onFailure }: { src: string; onFailure: () => void }) {
  // Mount only after tap: useVideoPlayer owns/releases the native player on unmount.
  const player = useVideoPlayer(src, instance => { instance.loop = false; instance.pause(); });
  const focused = useIsFocused();
  useEffect(() => { if (!focused) player.pause(); }, [focused, player]);
  useEffect(() => {
    const status = player.addListener('statusChange', ({ status: next }) => {
      if (next === 'error') onFailure();
    });
    const app = AppState.addEventListener('change', state => {
      if (state !== 'active') player.pause();
    });
    return () => { status.remove(); app.remove(); player.pause(); };
  }, [player, onFailure]);
  return <VideoView player={player} nativeControls contentFit="contain" style={styles.video} />;
}

function VideoPreview({ video }: { video: Extract<Inline, { kind: 'video' }> | Extract<Block, { kind: 'video' }> }) {
  const [active, setActive] = useState(false);
  const [failed, setFailed] = useState(false);
  const label = video.text || 'Video';
  return <View style={styles.videoFrame} onTouchStart={stopTouch}>
    {active && video.src && <PlayingVideo src={video.src} onFailure={() => { setActive(false); setFailed(true); }} />}
    {!active && <Pressable style={styles.videoStart} accessibilityRole="button"
      accessibilityLabel={!video.src ? `Video unavailable: ${label}` : failed ? `Video failed to load. Tap to retry: ${label}` : `Play video: ${label}`}
      disabled={!video.src} onPress={() => { setFailed(false); setActive(true); }}>
      <Text style={styles.imageLabel}>{!video.src ? `Video unavailable: ${label}` : failed ? `Video failed to load. Tap to retry: ${label}` : `▶ ${label}`}</Text>
    </Pressable>}
  </View>;
}

function RichText({ nodes, tone, style, allowed, onInteraction, suspended = false }: { nodes: Inline[]; tone: Tone; style: object; allowed: WeakSet<object>; onInteraction: () => void; suspended?: boolean }) {
  return <View style={styles.richText}>{segments(nodes).map((part, index) => part.kind === 'media'
    ? part.media.kind === 'image' ? <ImagePreview key={index} image={part.media} /> : <VideoPreview key={index} video={part.media} />
    : part.kind === 'math' ? <OfflineRenderer key={index} kind="math" source={part.node.text} enabled={allowed.has(part.node)} display={false} suspended={suspended} />
    : <AnimatedText key={index} selectable style={[style, tone('#172a40')]}>
        <InlineText nodes={part.nodes} tone={tone} onInteraction={onInteraction} />
      </AnimatedText>)}</View>;
}

const MAX_MATH_SOURCE = 4096;
const MAX_DIAGRAM_SOURCE = 6000;
const MAX_WEBVIEWS_PER_MESSAGE = 3;
function webViewAllowlist(blocks: Block[]): WeakSet<object> {
  const allowed = new WeakSet<object>();
  let count = 0;
  const add = (node: { kind: 'math' | 'diagram'; text: string }) => {
    if (node.text.length <= (node.kind === 'math' ? MAX_MATH_SOURCE : MAX_DIAGRAM_SOURCE) && count < MAX_WEBVIEWS_PER_MESSAGE) {
      allowed.add(node); count++;
    }
  };
  const inline = (nodes: Inline[]) => {
    for (const node of nodes) {
      if (node.kind === 'math') add(node);
      else if ('children' in node) inline(node.children);
    }
  };
  const visit = (items: Block[]) => {
    for (const block of items) {
      if (block.kind === 'math' || block.kind === 'diagram') {
        add(block);
      } else if (block.kind === 'quote') visit(block.children);
      else if (block.kind === 'list') block.items.forEach(visit);
      else if (block.kind === 'paragraph' || block.kind === 'heading') inline(block.children);
      else if (block.kind === 'table') [...block.header, ...block.rows.flat()].forEach(cell => inline(cell.children));
    }
  };
  visit(blocks);
  return allowed;
}
function OfflineRenderer({ kind, source, enabled, display = true, fullscreen = false, suspended = false }: { kind: 'math' | 'diagram'; source: string; enabled: boolean; display?: boolean; fullscreen?: boolean; suspended?: boolean }) {
  const { scale } = useFontSize();
  const [failedHtml, setFailedHtml] = useState<string | null>(null);
  const [readyHtml, setReadyHtml] = useState<string | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const tooLarge = !enabled || source.length > (kind === 'math' ? MAX_MATH_SOURCE : MAX_DIAGRAM_SOURCE);
  const html = useMemo(() => tooLarge ? '' : renderMarkdownHtml(kind, source, display, scale), [kind, source, tooLarge, display, scale]);
  useEffect(() => { if (suspended) setReadyHtml(null); }, [suspended]);
  const fallback = <ScrollView onTouchStart={stopTouch} style={fullscreen ? styles.fullscreenFallback : display ? styles.renderFallback : styles.inlineRenderFallback} nestedScrollEnabled>
    <Text selectable style={styles.codeText}>{source}</Text>
  </ScrollView>;
  if (tooLarge || failedHtml === html || suspended) return fallback;
  return <View onTouchStart={stopTouch} style={fullscreen ? styles.fullscreenDiagram : display ? styles.renderFrame : styles.inlineRenderFrame} onLayout={event => {
    const { width, height } = event.nativeEvent.layout;
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      setSize(previous => previous?.width === width && previous.height === height ? previous : { width, height });
    }
  }}>
    {/* Route every URL to our deny-by-default callback; WebView sends URLs outside its whitelist to Linking. */}
    {size && <WebView source={{ html }} originWhitelist={['*']} onShouldStartLoadWithRequest={request => request.url === 'about:blank'}
      onMessage={event => {
        if (event.nativeEvent.data === 'render-failed') setFailedHtml(html);
        else if (event.nativeEvent.data === 'render-ready') setReadyHtml(html);
      }}
      onError={() => setFailedHtml(html)} onHttpError={() => setFailedHtml(html)}
      onContentProcessDidTerminate={() => setFailedHtml(html)} onRenderProcessGone={() => setFailedHtml(html)} renderError={() => <View />}
      javaScriptEnabled domStorageEnabled={false} allowFileAccess={false} allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false} mixedContentMode="never" setSupportMultipleWindows={false}
      javaScriptCanOpenWindowsAutomatically={false} cacheEnabled={false} incognito
      sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false} scrollEnabled
      containerStyle={[styles.renderWebContainer, size]} style={[styles.renderWeb, size]} />}
    {readyHtml !== html && <View style={styles.renderPending}>{fallback}</View>}
  </View>;
}

function Cell({ cell, header, tone, allowed, width, onInteraction, suspended }: { cell: TableCell; header: boolean; tone: Tone; allowed: WeakSet<object>; width: number; onInteraction: () => void; suspended: boolean }) {
  return <View style={[styles.tableCell, { width }, header && styles.tableHeadCell]}>
    <View style={[styles.cellContent, cell.align === 'center' && styles.alignCenter, cell.align === 'right' && styles.alignRight]}>
      <RichText nodes={cell.children} tone={tone} allowed={allowed} style={header ? styles.tableHeadText : styles.paragraph} onInteraction={onInteraction} suspended={suspended} />
    </View>
  </View>;
}

function MarkdownTable({ block, tone, allowed, onExpand, onInteraction, suspended = false, fullscreen = false }: { block: Extract<Block, { kind: 'table' }>; fullscreen?: boolean } & BlockProps) {
  // Never squeeze a multi-column grid into the phone viewport. The frame is
  // bounded, but the actual grid retains readable cells and scrolls inside it.
  const columnWidth = 156;
  return <View style={styles.tableFrame} onTouchStart={stopTouch}>
    {!fullscreen && <ExpandButton label="View table fullscreen" onPress={() => onExpand({ kind: 'table', block })} />}
    <ScrollView horizontal nestedScrollEnabled style={styles.tableScroll} showsHorizontalScrollIndicator
      bounces={false} directionalLockEnabled automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never">
      <View style={styles.tableBody}>
        <View style={styles.tableRow}>{block.header.map((cell, i) => <Cell key={i} cell={cell} header tone={tone} allowed={allowed} width={columnWidth} onInteraction={onInteraction} suspended={suspended} />)}</View>
        {block.rows.map((row, i) => <View key={i} style={styles.tableRow}>
          {row.map((cell, j) => <Cell key={j} cell={cell} header={false} tone={tone} allowed={allowed} width={columnWidth} onInteraction={onInteraction} suspended={suspended} />)}
        </View>)}
      </View>
    </ScrollView>
  </View>;
}

function ExpandButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable onTouchStart={stopTouch} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={styles.expandButton} onPress={onPress}>
    <Text style={styles.expandText}>⤢ {label}</Text>
  </Pressable>;
}

type BlockProps = { tone: Tone; allowed: WeakSet<object>; onExpand: OpenExpand; onInteraction: () => void; suspended?: boolean };
function RenderBlock({ block, tone, allowed, onExpand, onInteraction, suspended = false, fullscreenDiagram = false }: { block: Block; fullscreenDiagram?: boolean } & BlockProps) {
  switch (block.kind) {
    case 'paragraph':
      return <RichText nodes={block.children} tone={tone} allowed={allowed} style={styles.paragraph} onInteraction={onInteraction} suspended={suspended} />;
    case 'heading':
      return <RichText nodes={block.children} tone={tone} allowed={allowed} style={[styles.heading, block.level === 1 ? styles.h1 : block.level === 2 ? styles.h2 : block.level === 3 ? styles.h3 : block.level === 4 ? styles.h4 : block.level === 5 ? styles.h5 : styles.h6]} onInteraction={onInteraction} suspended={suspended} />;
    case 'code':
      return <View style={styles.codeBox} onTouchStart={stopTouch}>
        <View style={styles.codeHeader}>
          <Text style={styles.codeLanguage} numberOfLines={1}>{block.language || 'Code'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Copy code" hitSlop={8} onPress={() => copy(block.text)}>
            <Text style={styles.copyCode}>Copy code</Text>
          </Pressable>
        </View>
        <ScrollView horizontal nestedScrollEnabled style={styles.codeScroll} showsHorizontalScrollIndicator>
          <AnimatedText selectable style={[styles.codeText, tone('#20314a')]}>{block.text || ' '}</AnimatedText>
        </ScrollView>
      </View>;
    case 'math':
      return <OfflineRenderer kind="math" source={block.text} enabled={allowed.has(block)} suspended={suspended} />;
    case 'diagram':
      return <View style={fullscreenDiagram ? styles.fullscreenDiagram : styles.diagramBlock} onTouchStart={stopTouch}>
        {!fullscreenDiagram && <ExpandButton label="View diagram fullscreen" onPress={() => onExpand({ kind: 'diagram', block })} />}
        <OfflineRenderer kind="diagram" source={block.text} enabled={allowed.has(block)} fullscreen={fullscreenDiagram} suspended={suspended} />
      </View>;
    case 'video':
      return <VideoPreview video={block} />;
    case 'quote':
      return <View style={styles.quote}><RenderBlocks blocks={block.children} tone={tone} allowed={allowed} onExpand={onExpand} onInteraction={onInteraction} suspended={suspended} /></View>;
    case 'list':
      return <View style={styles.list}>{block.items.map((item, index) =>
        <View key={index} style={styles.listRow}>
          {block.checks[index] !== null
            ? <View style={styles.bullet} accessibilityRole="checkbox" accessibilityState={{ checked: block.checks[index], disabled: true }}
                accessibilityLabel={block.checks[index] ? 'Completed' : 'Not completed'}>
                <AnimatedText style={tone('#425874')}>{block.checks[index] ? '☑' : '☐'}</AnimatedText>
              </View>
            : <AnimatedText style={[styles.bullet, tone('#425874')]}>{block.ordered ? `${block.start + index}.` : '•'}</AnimatedText>}
          <View style={styles.listBody}><RenderBlocks blocks={item} tone={tone} allowed={allowed} onExpand={onExpand} onInteraction={onInteraction} suspended={suspended} /></View>
        </View>)}</View>;
    case 'table':
      return <MarkdownTable block={block} tone={tone} allowed={allowed} onExpand={onExpand} onInteraction={onInteraction} suspended={suspended} />;
    case 'rule': return <View style={styles.rule} />;
  }
}

function RenderBlocks({ blocks, tone, allowed, onExpand, onInteraction, suspended }: { blocks: Block[] } & BlockProps) {
  return <View style={styles.blocks}>{blocks.map((block, index) => <RenderBlock key={index} block={block} tone={tone} allowed={allowed} onExpand={onExpand} onInteraction={onInteraction} suspended={suspended} />)}</View>;
}

function ToolCalls({ calls, onInteraction, compact = true, onDetails }: { calls?: readonly ToolCall[]; onInteraction: () => void; compact?: boolean; onDetails?: () => void }) {
  if (!calls?.length) return null;
  // Native Text owns the long-press menu and its anchor. Do not open another
  // window or become a responder: that disrupts the composer's keyboard.
  return <View style={styles.toolCalls} onTouchStart={event => { onInteraction(); stopTouch(event); }}>{calls.map(call => {
    const { icon, command: terminal } = toolPresentation(call.name);
    const detail = call.detail && compact ? compactFileDetail(call.name, call.detail) : call.detail;
    const shortened = compact && !!call.detail && detail !== call.detail;
    const label = <Text selectable numberOfLines={1} ellipsizeMode="tail" style={shortened ? [styles.toolLabel, styles.toolLineText] : styles.toolLabel}>{icon} {toolDisplayLabel(call.name, call.label)}{!terminal && detail ? ` ${detail.replace(/\s+/g, ' ')}` : ''}</Text>;
    return <View key={call.id} style={styles.toolCall}>
      {shortened && onDetails ? <View style={styles.toolLine}>{label}<Pressable accessibilityRole="button" accessibilityLabel="View file details" hitSlop={8} onPress={onDetails}><Text style={styles.toolDetailsLink}>↗</Text></Pressable></View> : label}
      {terminal && !!call.detail && <View style={styles.toolDetail}>
        <Text selectable numberOfLines={2} ellipsizeMode="tail" style={[styles.codeText, styles.toolDetailText]}>{call.detail}</Text>
      </View>}
    </View>;
  })}</View>;
}

function ArticleContent({ text, blocks, toolCalls, onExpand, tone, allowed }: { text: string; blocks: Block[]; toolCalls?: readonly ToolCall[]; onExpand: OpenExpand; tone: Tone; allowed: WeakSet<object> }) {
  const { scale } = useFontSize();
  const page = useMemo(() => {
    if (text.length > ARTICLE_TEXT_LIMIT) return null;
    const result = renderArticleHtml(blocks, toolCalls, scale);
    return result.html.length <= 8_000_000 ? result : null; // includes the local engine bundles
  }, [text, blocks, toolCalls, scale]);
  const [failed, setFailed] = useState(false);
  if (!page || failed) return <ScrollView style={styles.modalScroll} contentContainerStyle={styles.articleFallbackContent}>
    <Text style={styles.articleFailure}>{!page ? 'This article is too long. Showing the standard view instead.' : 'This article could not load. Showing the standard view instead.'}</Text>
    <RenderBlocks blocks={blocks} tone={tone} allowed={allowed} onExpand={onExpand} onInteraction={() => {}} suspended />
    <ToolCalls calls={toolCalls} compact={false} onInteraction={() => {}} />
  </ScrollView>;
  return <WebView style={styles.articleWeb} source={{ html: page.html }} originWhitelist={['*']}
    onShouldStartLoadWithRequest={request => request.url === 'about:blank'}
    onMessage={event => {
      const match = /^(expand|link):(0|[1-9][0-9]{0,8})$/.exec(event.nativeEvent.data);
      if (!match) return;
      const index = Number(match[2]);
      // Only typed indices into this message's AST; no URL or arbitrary command bridge.
      if (match[1] === 'expand') {
        const target = page.expansions[index];
        if (target && target.block.kind === target.kind) onExpand(target);
      } else {
        const href = page.links[index];
        if (href && safeLinkUrl(href) === href) void Linking.openURL(href).catch(() => Alert.alert('Could not open link'));
      }
    }}
    onError={() => setFailed(true)} onHttpError={() => setFailed(true)}
    onContentProcessDidTerminate={() => setFailed(true)} onRenderProcessGone={() => setFailed(true)}
    renderError={() => <View />}
    javaScriptEnabled domStorageEnabled={false} allowFileAccess={false} allowFileAccessFromFileURLs={false}
    allowUniversalAccessFromFileURLs={false} mixedContentMode="never" setSupportMultipleWindows={false}
    javaScriptCanOpenWindowsAutomatically={false} cacheEnabled={false} incognito
    sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false} />;
}

function ExpandedContent({ target, text, blocks, toolCalls, onExpand, tone, allowed }: {
  target: ExpandTarget; text: string; blocks: Block[]; toolCalls?: readonly ToolCall[];
  onExpand: OpenExpand; tone: Tone; allowed: WeakSet<object>;
}) {
  // Native Stack retains this document when a child route covers it, including
  // its WebView scroll/selection state. Do not unmount it on blur.
  // ViewerScreen already provides bottom/side safe-area padding. Keep the
  // article viewport edge-to-edge so its native scroll indicator reaches the
  // safe-area edge; prose padding belongs inside the document. Non-article
  // viewers still need a bounded native layout.
  return <View style={target.kind === 'message' ? styles.viewer : styles.insetViewer}>
    {target.kind === 'message'
      ? <ArticleContent text={text} blocks={blocks} toolCalls={toolCalls} onExpand={onExpand} tone={tone} allowed={allowed} />
      : target.kind === 'table' && target.block.kind === 'table'
        ? <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent} nestedScrollEnabled keyboardShouldPersistTaps="always">
            <MarkdownTable block={target.block} tone={tone} allowed={allowed} onExpand={onExpand} onInteraction={() => {}} fullscreen />
          </ScrollView>
        : target.block.kind === 'diagram'
          ? <RenderBlock block={target.block} tone={tone} allowed={allowed} onExpand={onExpand} onInteraction={() => {}} fullscreenDiagram />
          : null}
  </View>;
}

/** Native renderer: validated remote images load automatically in a fixed frame. */
export const MessageContent = memo(function MessageContent({ text, toolCalls, pending = false, canExpand = false }: { text: string; toolCalls?: readonly ToolCall[]; pending?: boolean; canExpand?: boolean }) {
  const parsed = useMemo(() => parseMessageMarkdown(text), [text]);
  const allowed = useMemo(() => webViewAllowlist(parsed), [parsed]);
  const focused = useIsFocused();
  const { openViewer } = useViewer();
  const expand: OpenExpand = target => openViewer(target.kind === 'message' ? 'Message' : target.kind === 'table' ? 'Table' : 'Diagram',
    <ExpandedContent target={target} text={text} blocks={parsed} toolCalls={toolCalls} onExpand={expand} tone={tone} allowed={allowed} />);
  // Observe ordinary text taps without becoming a responder (selection and
  // nested links/scroll views retain their native touch handling).
  const gesture = useRef<{ start?: { target: number; x: number; y: number; at: number }; tap?: { target: number; x: number; y: number; at: number } }>({});
  const point = (event: GestureResponderEvent) => {
    const { target, pageX, pageY, touches } = event.nativeEvent;
    return typeof target === 'number' && Number.isFinite(pageX) && Number.isFinite(pageY) && (!touches || touches.length <= 1)
      ? { target, x: pageX, y: pageY, at: Date.now() } : null;
  };
  const touchStart = (event: GestureResponderEvent) => { if (focused) gesture.current.start = point(event) || undefined; };
  const touchMove = (event: GestureResponderEvent) => {
    const start = gesture.current.start, now = point(event);
    if (!start || !now || Math.abs(start.x - now.x) > 10 || Math.abs(start.y - now.y) > 10) gesture.current = {};
  };
  const touchEnd = (event: GestureResponderEvent) => {
    const start = gesture.current.start, now = point(event), previous = gesture.current.tap;
    gesture.current = {};
    if (!focused || !canExpand || !start || !now || now.target !== start.target || now.at - start.at > 250 ||
      Math.abs(start.x - now.x) > 10 || Math.abs(start.y - now.y) > 10) return;
    if (previous && previous.target === now.target && now.at - previous.at <= 350 &&
      Math.abs(previous.x - now.x) <= 24 && Math.abs(previous.y - now.y) <= 24) expand({ kind: 'message' });
    else gesture.current.tap = now;
  };
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
  return <View style={styles.root} onTouchStart={touchStart} onTouchMove={touchMove} onTouchEnd={touchEnd} onTouchCancel={() => { gesture.current = {}; }}>
    <RenderBlocks blocks={parsed} tone={tone} allowed={allowed} onExpand={expand} onInteraction={() => { gesture.current = {}; }} />
    <ToolCalls calls={toolCalls} onDetails={canExpand ? () => expand({ kind: 'message' }) : undefined} onInteraction={() => { gesture.current = {}; }} />
  </View>;
});

const styles = StyleSheet.create({
  toolCalls: { minWidth: 0, gap: 4, paddingVertical: 0 },
  toolCall: { minWidth: 0, gap: 2 },
  toolLine: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  toolLineText: { flex: 1, minWidth: 0 },
  toolDetailsLink: { color: '#52657c', fontSize: 13, lineHeight: 20 },
  toolDetailText: { paddingVertical: 4 },
  toolLabel: { color: '#52657c', fontSize: 13, lineHeight: 20 },
  toolDetail: { width: '100%', maxWidth: '100%', borderRadius: 8, backgroundColor: '#e8eef6' },

  root: { alignSelf: 'stretch', minWidth: 0 },
  blocks: { alignSelf: 'stretch', minWidth: 0, gap: 8 },
  paragraph: { color: '#172a40', fontSize: 15, lineHeight: 23, flexShrink: 1 },
  heading: { color: '#172a40', fontWeight: '700', flexShrink: 1 },
  h1: { fontSize: 21, lineHeight: 28 }, h2: { fontSize: 18, lineHeight: 26 },
  h3: { fontSize: 17, lineHeight: 25 }, h4: { fontSize: 16, lineHeight: 24 }, h5: { fontSize: 15, lineHeight: 23 }, h6: { fontSize: 14, lineHeight: 22 },
  strong: { fontWeight: '700' }, em: { fontStyle: 'italic' }, strike: { textDecorationLine: 'line-through' },
  link: { color: '#215ca7', textDecorationLine: 'underline' },
  inlineCode: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', backgroundColor: '#dce5f0', color: '#20314a', fontSize: 14 },
  richText: { minWidth: 0 },
  imageFrame: { width: '100%', maxWidth: 280, height: 168, borderWidth: 1, borderRadius: 8, borderColor: '#d6e0ed', backgroundColor: '#f2f5fa', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  imageLabel: { color: '#52657c', fontSize: 13, textAlign: 'center', padding: 10 },
  videoFrame: { width: '100%', maxWidth: 280, height: 168, borderRadius: 8, backgroundColor: '#162132', overflow: 'hidden' },
  video: { width: '100%', height: '100%' },
  videoStart: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  renderFrame: { width: '100%', minWidth: 0, height: 220, overflow: 'hidden' },
  inlineRenderFrame: { width: '100%', minWidth: 0, height: 72, overflow: 'hidden' },
  inlineRenderFallback: { width: '100%', height: 72 },
  // WebView's style reaches its inner native view, not its flex:1 wrapper.
  renderWebContainer: { flex: 0 },
  renderWeb: { flex: 0, backgroundColor: 'transparent' },
  renderPending: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
  renderFallback: { width: '100%', height: 220, padding: 8 },
  fullscreenFallback: { flex: 1, width: '100%', padding: 8 },
  diagramBlock: { width: '100%', minWidth: 0 },
  fullscreenDiagram: { flex: 1, minHeight: 0, width: '100%' },
  expandButton: { alignSelf: 'flex-end', paddingVertical: 5, paddingHorizontal: 4 },
  expandText: { color: '#215ca7', fontSize: 12 },
  viewer: { flex: 1, backgroundColor: '#fff' },
  insetViewer: { flex: 1, backgroundColor: '#fff', paddingBottom: 12, paddingHorizontal: 14 },
  modalScroll: { flex: 1, minWidth: 0 },
  modalScrollContent: { paddingBottom: 16 },
  articleFallbackContent: { paddingBottom: 28, paddingHorizontal: 14 },
  articleWeb: { flex: 1, backgroundColor: '#fff' },
  articleFailure: { color: '#52657c', fontSize: 13, paddingBottom: 10 },
  quote: { borderLeftWidth: 3, borderLeftColor: '#9ab2d2', paddingLeft: 10, minWidth: 0 },
  list: { gap: 5, minWidth: 0 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', minWidth: 0 },
  bullet: { width: 26, flexShrink: 0, color: '#425874', fontSize: 15, lineHeight: 23 },
  listBody: { flex: 1, minWidth: 0 },
  rule: { height: 1, backgroundColor: '#d7e0eb', width: '100%' },
  codeBox: { width: '100%', minWidth: 0, borderRadius: 8, borderWidth: 1, borderColor: '#d6e0ed', backgroundColor: '#e8eef6', overflow: 'hidden' },
  codeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, gap: 8, backgroundColor: '#e5ecf5' },
  codeLanguage: { color: '#52657c', fontSize: 12, flexShrink: 1 }, copyCode: { color: '#215ca7', fontSize: 12, fontWeight: '600' },
  codeScroll: { width: '100%', maxWidth: '100%' },
  codeText: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: '#20314a', fontSize: 13, lineHeight: 19, padding: 10 },
  tableFrame: { width: '100%', minWidth: 0, maxWidth: '100%', overflow: 'hidden' },
  tableScroll: { width: '100%', maxWidth: '100%' },
  tableBody: { alignSelf: 'flex-start', borderTopWidth: 1, borderLeftWidth: 1, borderColor: '#d6e0ed' },
  tableRow: { flexDirection: 'row' },
  tableCell: { width: 156, borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#d6e0ed', padding: 8 },
  tableHeadCell: { backgroundColor: '#e5ecf5' },
  tableHeadText: { fontSize: 15, lineHeight: 23, fontWeight: '700' },
  cellContent: { minWidth: 0 },
  alignCenter: { alignItems: 'center' }, alignRight: { alignItems: 'flex-end' },
});
