/** A centered panel over a dimmed backdrop, used for dialogs and forms. */
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { T } from '../strings';
import { Btn } from './ActionBar';

export function Sheet({ title, onClose, children, width = 520 }: { title: string; onClose?: () => void; children: ReactNode; width?: number }) {
  return (
    <View style={styles.backdrop}>
      <View style={[styles.panel, { maxWidth: width }]}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          {onClose && <Btn label={T.close} onPress={onClose} />}
        </View>
        <ScrollView contentContainerStyle={styles.body}>{children}</ScrollView>
      </View>
    </View>
  );
}

export const formStyles = StyleSheet.create({
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cfd8dc',
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    minWidth: 160,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  label: { color: '#37474f', fontSize: 14, fontWeight: '600' },
  hint: { color: '#78909c', fontSize: 12 },
  error: { color: '#c62828', fontSize: 13 },
});

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  panel: { backgroundColor: '#fdfaf2', borderRadius: 16, width: '100%', maxHeight: '100%', padding: 14 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  title: { fontSize: 17, fontWeight: '800', color: '#3e2723' },
  body: { gap: 10, paddingBottom: 4 },
});
