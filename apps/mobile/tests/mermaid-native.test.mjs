import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dependency = new URL('../node_modules/react-native-webview/', import.meta.url);

// Inspect the installed native package, not assumptions about WebView props.
test('installed iOS WebView sizes the wrapper separately from its native child', () => {
  const ios = readFileSync(new URL('src/WebView.ios.tsx', dependency), 'utf8');
  const styles = readFileSync(new URL('src/WebView.styles.ts', dependency), 'utf8');
  assert.match(ios, /webViewStyles = \[styles\.container, styles\.webView, style\]/);
  assert.match(ios, /webViewContainerStyle = \[styles\.container, containerStyle\]/);
  assert.match(ios, /<NativeWebView[\s\S]*?style=\{webViewStyles\}/);
  assert.match(ios, /<View style=\{webViewContainerStyle\}>/);
  assert.match(styles, /container: \{\s*flex: 1,/);
});

test('installed iOS WebView loads inline HTML from about:blank and consults the JS navigation veto', () => {
  const native = readFileSync(new URL('apple/RNCWebViewImpl.m', dependency), 'utf8');
  const ios = readFileSync(new URL('src/WebView.ios.tsx', dependency), 'utf8');
  assert.match(native, /NSString \*html = \[RCTConvert NSString:_source\[@"html"\]\]/);
  assert.match(native, /baseURL = \[NSURL URLWithString:@"about:blank"\]/);
  assert.match(native, /\[_webView loadHTMLString:html baseURL:baseURL\]/);
  assert.match(native, /_onShouldStartLoadWithRequest\(event\)/);
  assert.match(ios, /messagingEnabled=\{typeof onMessageProp === 'function'\}/);
  assert.match(native, /initWithSource:[\s\S]*?window\.%@\.postMessage = function \(data\)/);
});
