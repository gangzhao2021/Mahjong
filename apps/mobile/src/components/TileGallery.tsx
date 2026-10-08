/** Development aid: every tile face at the sizes the table uses (web: open with ?tiles). */
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Tile } from './Tile';

const SIZES = [16, 24, 42, 54];

export function TileGallery() {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {SIZES.map((w) => (
        <View key={w} style={styles.block}>
          <Text style={styles.label}>{w}px</Text>
          {[0, 1, 2].map((suit) => (
            <View key={suit} style={styles.row}>
              {Array.from({ length: 9 }, (_, r) => (
                <Tile key={r} tile={suit * 9 + r} width={w} />
              ))}
            </View>
          ))}
        </View>
      ))}
      <View style={styles.row}>
        <Tile tile={4} width={42} highlighted />
        <Tile tile={13} width={42} dimmed />
        <Tile tile={22} width={42} rotated />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1f6b47' },
  content: { padding: 16, gap: 16 },
  block: { gap: 6 },
  row: { flexDirection: 'row', gap: 4, alignItems: 'flex-end' },
  label: { color: '#fff8e1', fontWeight: '700' },
});
