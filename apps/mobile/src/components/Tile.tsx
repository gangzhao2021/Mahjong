import { HIDDEN_TILE, rankOf, suitOf, type Tile as TileKind } from '@mahjong/engine';
import { memo } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { RANK_NAMES, SUIT_NAMES } from '../strings';
import { TileFace } from './TileFace';

export interface TileProps {
  tile: TileKind | null;
  width: number;
  /** Show the back (concealed tile of another player). */
  back?: boolean;
  dimmed?: boolean;
  highlighted?: boolean;
  /** Lying sideways in a side player's area: true turns the top to the right, 'ccw' to the left. */
  rotated?: boolean | 'ccw';
  style?: ViewStyle;
}

export const TILE_RATIO = 1.36;

function TileView({ tile, width, back, dimmed, highlighted, rotated, style }: TileProps) {
  const height = Math.round(width * TILE_RATIO);
  const box: ViewStyle = rotated ? { width: height, height: width } : { width, height };

  if (back || tile === null || tile === HIDDEN_TILE) {
    return <View style={[styles.tile, styles.back, box, style]} />;
  }
  const suit = suitOf(tile);
  // Inside the border (1 px sides and top, 3 px bottom edge).
  const faceW = width - 2;
  const faceH = height - 4;
  return (
    <View
      style={[styles.tile, styles.face, box, highlighted && styles.highlighted, dimmed && styles.dimmed, style]}
      accessibilityLabel={`${RANK_NAMES[rankOf(tile) - 1]} ${SUIT_NAMES[suit]}`}
    >
      <View style={rotated ? { transform: [{ rotate: rotated === 'ccw' ? '-90deg' : '90deg' }] } : null}>
        <TileFace tile={tile} width={faceW} height={faceH} />
      </View>
    </View>
  );
}

export const Tile = memo(TileView);

const styles = StyleSheet.create({
  tile: {
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderBottomWidth: 3,
  },
  face: {
    backgroundColor: '#fbf7ec',
    borderColor: '#cfc6ad',
  },
  back: {
    backgroundColor: '#2e8b57',
    borderColor: '#1c5c38',
  },
  highlighted: {
    backgroundColor: '#fff3b0',
    borderColor: '#e0a800',
  },
  dimmed: {
    opacity: 0.45,
  },
});
