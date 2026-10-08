/** Decorative fan of tiles (one of each suit), for the lobby and login screens. */
import { StyleSheet, View } from 'react-native';
import { Tile } from './Tile';

const FAN = [
  { tile: 0, rotate: '-14deg', dy: 6 }, // 一萬
  { tile: 22, rotate: '0deg', dy: 0 }, // 五筒
  { tile: 9, rotate: '14deg', dy: 6 }, // 一条 (the bird)
];

export function TileFan({ width }: { width: number }) {
  return (
    <View style={[styles.row, { height: width * 1.6 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {FAN.map((f, i) => (
        <View key={i} style={[styles.tile, { marginHorizontal: -width * 0.08, transform: [{ translateY: f.dy }, { rotate: f.rotate }] }]}>
          <Tile tile={f.tile} width={width} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  tile: { shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
});
