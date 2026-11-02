import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './FontSize';
import { reportClientError } from './clientLogs';

type Props = { children: React.ReactNode };
type State = { failed: boolean; attempt: number };

/** Keeps a render failure inside one page: it reports the error and offers a retry. */
export class PageErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false, attempt: 0 };
  static getDerivedStateFromError(): Partial<State> { return { failed: true }; }
  componentDidCatch(error: unknown, info: React.ErrorInfo) { reportClientError('render', error, { componentStack: info.componentStack ?? '' }); }
  render() {
    if (!this.state.failed) return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
    return <View style={s.box}>
      <Text style={s.text}>This conversation could not be shown.</Text>
      <Pressable accessibilityRole="button" onPress={() => this.setState(state => ({ failed: false, attempt: state.attempt + 1 }))} style={({ pressed }) => [s.button, pressed && s.pressed]}>
        <Text style={s.label}>Try again</Text>
      </Pressable>
    </View>;
  }
}

const s = StyleSheet.create({
  box: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  text: { fontSize: 16, color: '#334155', textAlign: 'center' },
  button: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: '#2b4e81' },
  pressed: { backgroundColor: '#edf3fc' },
  label: { fontSize: 15, color: '#2b4e81' },
});
