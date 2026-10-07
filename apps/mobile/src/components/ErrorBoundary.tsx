/** Catches render crashes, reports them, and offers a way back instead of a blank screen. */
import { Component, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { reportError } from '../net/crash';
import { T } from '../strings';
import { Btn } from './ActionBar';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    reportError(error, { source: 'render', componentStack: info.componentStack?.slice(0, 1500) });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.root}>
        <Text style={styles.title}>{T.crashTitle}</Text>
        <Text style={styles.text}>{T.crashText}</Text>
        <Btn label={T.crashRetry} primary onPress={() => this.setState({ failed: false })} />
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: '#1f6b47', padding: 24 },
  title: { fontSize: 22, fontWeight: '800', color: '#fff8e1' },
  text: { color: '#c8e6c9', textAlign: 'center' },
});
