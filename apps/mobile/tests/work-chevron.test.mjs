import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/WorkChevron.tsx', import.meta.url), 'utf8');
function render(expanded, loaded, error = null) {
  const output = { exports: {} };
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) };
  const fontPath = '../../../assets/work-icons.ttf';
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText, {
    exports: output.exports, module: output,
    require: name => name === 'react' ? { ...react, default: react } : name === 'react-native' ? { Text: 'Text' } : name === 'expo-font' ? { useFonts: fonts => { assert.equal(fonts.HermesWorkIcons, 'font-asset'); return [loaded, error]; } } : name === fontPath ? 'font-asset' : assert.fail(name)
  });
  return output.exports.WorkChevron({ expanded });
}
test('work arrows use the bundled icon font, with down expanded and right collapsed', () => {
  for (const [expanded, glyph] of [[true, '\ue001'], [false, '\ue002']]) {
    const tree = render(expanded, true);
    assert.equal(tree.props.children[0], glyph);
    assert.equal(tree.props.style.fontFamily, 'HermesWorkIcons');
    assert.equal(tree.props.accessible, false);
    assert.equal(tree.props.allowFontScaling, false);
    assert.equal(tree.props.importantForAccessibility, 'no-hide-descendants');
  }
  const bytes = readFileSync(new URL('../../../assets/work-icons.ttf', import.meta.url));
  assert.equal(bytes.readUInt32BE(0), 0x00010000, 'real TrueType font');
});
test('loading or failed font leaves fixed decorative space, not a fallback text arrow or missing glyph', () => {
  for (const error of [null, new Error('Font unavailable')]) {
    const tree = render(true, false, error);
    assert.equal(tree.props.children[0], '');
    assert.equal(tree.props.style.width, 18);
    assert.equal(tree.props.style.height, 18);
  }
});
