/**
 * The human player's concealed hand. Double-tap or swipe a tile upward to
 * discard (PRD §15); single tap selects (used for the swap and the 出牌 button).
 */
import { suitOf, type Suit, type Tile as TileKind } from '@mahjong/engine';
import { useMemo, useRef } from 'react';
import { StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { Tile } from './Tile';

export interface HandTile {
  key: string;
  tile: TileKind;
}

interface Props {
  hand: TileKind[];
  /** The freshly drawn tile, shown slightly apart on the right. */
  drawn: TileKind | null;
  voidSuit: Suit | null;
  tileWidth: number;
  /** Tiles that may be discarded now; null = discarding not allowed. */
  discardable: TileKind[] | null;
  selected: string[];
  onSelect(item: HandTile): void;
  onDiscard(tile: TileKind): void;
}

const DOUBLE_TAP_MS = 320;
const SWIPE_UP_PX = 28;

/** Orders the hand by suit with the void suit last, and splits off the drawn tile. */
export function arrangeHand(hand: TileKind[], drawn: TileKind | null, voidSuit: Suit | null): { main: HandTile[]; drawn: HandTile | null } {
  const tiles = [...hand];
  let drawnItem: HandTile | null = null;
  if (drawn !== null) {
    const i = tiles.lastIndexOf(drawn);
    if (i >= 0) {
      tiles.splice(i, 1);
      drawnItem = { key: 'drawn', tile: drawn };
    }
  }
  const order = (t: TileKind) => (suitOf(t) === voidSuit ? 100 + t : t);
  tiles.sort((a, b) => order(a) - order(b));
  return { main: tiles.map((tile, i) => ({ key: `h${i}-${tile}`, tile })), drawn: drawnItem };
}

export function PlayerHand({ hand, drawn, voidSuit, tileWidth, discardable, selected, onSelect, onDiscard }: Props) {
  const arranged = useMemo(() => arrangeHand(hand, drawn, voidSuit), [hand, drawn, voidSuit]);
  const items = arranged.drawn ? [...arranged.main, arranged.drawn] : arranged.main;

  return (
    <View style={styles.row}>
      {items.map((item) => (
        <HandTileView
          key={item.key}
          item={item}
          width={tileWidth}
          gap={item.key === 'drawn' ? tileWidth * 0.4 : 1}
          selected={selected.includes(item.key)}
          canDiscard={discardable?.includes(item.tile) ?? false}
          dimmed={discardable !== null && !discardable.includes(item.tile)}
          onSelect={onSelect}
          onDiscard={onDiscard}
        />
      ))}
    </View>
  );
}

interface TileViewProps {
  item: HandTile;
  width: number;
  gap: number;
  selected: boolean;
  canDiscard: boolean;
  dimmed: boolean;
  onSelect(item: HandTile): void;
  onDiscard(tile: TileKind): void;
}

function HandTileView({ item, width, gap, selected, canDiscard, dimmed, onSelect, onDiscard }: TileViewProps) {
  const lastTap = useRef(0);
  const pressStart = useRef<{ x: number; y: number } | null>(null);

  // One responder handles both gestures, identically for touch and mouse:
  // release after moving up = swipe discard; release in place = tap (double tap discards).
  const onRelease = (e: GestureResponderEvent) => {
    const start = pressStart.current;
    pressStart.current = null;
    if (!start) return;
    const dx = e.nativeEvent.pageX - start.x;
    const dy = e.nativeEvent.pageY - start.y;
    if (dy < -SWIPE_UP_PX && Math.abs(dy) > Math.abs(dx)) {
      if (canDiscard) onDiscard(item.tile);
      return;
    }
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) return;
    const now = Date.now();
    if (canDiscard && now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      onDiscard(item.tile);
      return;
    }
    lastTap.current = now;
    onSelect(item);
  };

  return (
    <View
      accessibilityRole="button"
      onStartShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => {
        pressStart.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
      }}
      onResponderRelease={onRelease}
      onResponderTerminate={() => {
        pressStart.current = null;
      }}
      style={{ marginLeft: gap, transform: [{ translateY: selected ? -width * 0.35 : 0 }] }}
    >
      <Tile tile={item.tile} width={width} dimmed={dimmed} highlighted={selected} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
});
