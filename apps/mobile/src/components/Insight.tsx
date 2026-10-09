/** The player's own read on the hand: waits, what a discard would leave, and the tile tracker (记牌器). */
import type { HandView, Tile as TileKind } from '@mahjong/engine';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { discardOutcome, unseenCounts, waitsOf, type Wait } from '../game/insight';
import { T } from '../strings';
import { Tile } from './Tile';

interface PanelProps {
  view: HandView;
  /** Tile under the pointer or selected, during my discard. */
  focus: TileKind | null;
  tileWidth: number;
}

/**
 * Left of the action buttons, above the hand:
 * - on my discard, what discarding the focused tile would leave;
 * - otherwise, my waits when ready (听牌).
 */
export function InsightPanel({ view, focus, tileWidth }: PanelProps) {
  const me = view.players[view.seat];
  const hand = me.hand;
  if (!hand || me.won || view.phase !== 'play') return null;
  const unseen = unseenCounts(view);
  const myDiscard = view.stage.kind === 'turn' && view.stage.seat === view.seat && !!view.legal.discard;

  if (myDiscard) {
    if (focus === null || !hand.includes(focus)) return null;
    const outcome = discardOutcome(focus, view, unseen);
    return (
      <View style={styles.panel}>
        <Text style={styles.label}>{T.ifDiscard}</Text>
        <Tile tile={focus} width={tileWidth} />
        {outcome.waits.length ? (
          <Waits waits={outcome.waits} tileWidth={tileWidth} />
        ) : (
          <Text style={styles.muted}>{T.shantenAfter(outcome.shanten)}</Text>
        )}
      </View>
    );
  }

  // 13-tile hand (3n+1) between turns.
  if ((hand.length - 1) % 3 !== 0) return null;
  const waits = waitsOf(hand, view, unseen);
  if (!waits.length) return null;
  return (
    <View style={[styles.panel, styles.ready]}>
      <Waits waits={waits} tileWidth={tileWidth} />
    </View>
  );
}

function Waits({ waits, tileWidth }: { waits: Wait[]; tileWidth: number }) {
  const total = waits.reduce((n, w) => n + w.left, 0);
  return (
    <>
      <Text style={styles.label}>{T.waiting}</Text>
      {waits.map((w) => (
        <View key={w.tile} style={[styles.wait, w.left === 0 && styles.gone]}>
          <Tile tile={w.tile} width={tileWidth} />
          <Text style={styles.count}>{w.left}</Text>
        </View>
      ))}
      <Text style={[styles.total, total === 0 && styles.none]}>{total === 0 ? T.waitingNone : T.tilesLeft(total)}</Text>
    </>
  );
}

/** Overlay listing how many of each tile this seat has not seen yet. */
export function TileTracker({ view, onClose }: { view: HandView; onClose(): void }) {
  const unseen = unseenCounts(view);
  const voidSuit = view.players[view.seat].voidSuit;
  return (
    <Pressable style={styles.trackerBackdrop} onPress={onClose} accessibilityRole="button">
      <View style={styles.tracker}>
        <Text style={styles.trackerTitle}>{T.trackerTitle}</Text>
        {[0, 1, 2].map((suit) => (
          <View key={suit} style={[styles.trackerRow, suit === voidSuit && styles.gone]}>
            {Array.from({ length: 9 }, (_, r) => {
              const tile = suit * 9 + r;
              const left = unseen[tile];
              return (
                <View key={tile} style={[styles.trackerCell, left === 0 && styles.gone]}>
                  <Tile tile={tile} width={26} />
                  <Text style={[styles.trackerCount, left === 0 && styles.zero]}>{left}</Text>
                </View>
              );
            })}
          </View>
        ))}
        <Text style={styles.trackerNote}>{T.trackerNote}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
  },
  ready: { borderWidth: 1.5, borderColor: '#ffd54f' },
  label: { color: '#ffe082', fontSize: 13, fontWeight: '800' },
  muted: { color: '#c8e6c9', fontSize: 13 },
  wait: { alignItems: 'center' },
  count: { color: '#fff', fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] },
  total: { color: '#fff', fontSize: 13, fontWeight: '700', marginLeft: 2 },
  none: { color: '#ffab91' },
  gone: { opacity: 0.35 },
  trackerBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'flex-end', paddingTop: 54, paddingRight: 12 },
  tracker: { backgroundColor: 'rgba(10,40,26,0.95)', borderRadius: 14, padding: 10, gap: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  trackerTitle: { color: '#ffe082', fontWeight: '800', fontSize: 14 },
  trackerRow: { flexDirection: 'row', gap: 3 },
  trackerCell: { alignItems: 'center' },
  trackerCount: { color: '#fff', fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  zero: { color: '#ff8a80' },
  trackerNote: { color: '#a5d6a7', fontSize: 11, maxWidth: 280 },
});
