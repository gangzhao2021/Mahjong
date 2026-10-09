/** Small presentational pieces of the table: melds, ponds, seat cards, countdown. */
import type { DiscardRecord, Meld, Suit, WinRecord } from '@mahjong/engine';
import type { SeatInfo, TimerInfo } from '@mahjong/protocol';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SUIT_NAMES, T } from '../strings';
import { PopIn } from './PopIn';
import { Tile } from './Tile';

export function Melds({ melds, tileWidth }: { melds: Meld[]; tileWidth: number }) {
  if (!melds.length) return null;
  return (
    <View style={styles.melds}>
      {melds.map((m, i) => {
        const n = m.type === 'pong' ? 3 : 4;
        const concealed = m.type === 'concealedKong';
        return (
          <View key={i} style={styles.meld}>
            {Array.from({ length: n }, (_, k) => (
              // A concealed kong shows its two middle tiles face up to its owner, backs to others.
              <Tile key={k} tile={m.tile} width={tileWidth} back={concealed && (k === 0 || k === 3 || m.tile < 0)} />
            ))}
          </View>
        );
      })}
    </View>
  );
}

/**
 * A player's discards, laid out the way they land on a real table: in front of
 * that player, starting next to the compass and growing back toward them.
 * Side players' tiles lie sideways with their tops toward the centre.
 * side: 0 = me (bottom), 1 = right, 2 = top, 3 = left.
 */
export function Pond({ discards, tileWidth, perLine, side, lastDiscard }: { discards: DiscardRecord[]; tileWidth: number; perLine: number; side: 0 | 1 | 2 | 3; lastDiscard: boolean }) {
  const visible = discards.filter((d) => !d.claimed);
  const vertical = side === 1 || side === 3;
  const span = perLine * (tileWidth + 2);
  return (
    <View style={[styles.pond, POND_FLOW[side], vertical ? { height: span } : { width: span }]}>
      {visible.map((d, i) => (
        // Each discard pops in once, when it first lands in the pond.
        <PopIn key={i} from={1.4}>
          <Tile
            tile={d.tile}
            width={tileWidth}
            rotated={side === 3 ? true : side === 1 ? 'ccw' : undefined}
            highlighted={lastDiscard && i === visible.length - 1}
            style={{ margin: 1 }}
          />
        </PopIn>
      ))}
    </View>
  );
}

/** Reading order of each pond from its owner's seat; new lines are added on the owner's side. */
const POND_FLOW = {
  0: { flexDirection: 'row', flexWrap: 'wrap' },
  1: { flexDirection: 'column-reverse', flexWrap: 'wrap' },
  2: { flexDirection: 'row-reverse', flexWrap: 'wrap-reverse' },
  3: { flexDirection: 'column', flexWrap: 'wrap-reverse' },
} as const;

interface SeatCardProps {
  info: SeatInfo;
  score: number;
  voidSuit: Suit | null;
  dealer: boolean;
  active: boolean;
  /** Set once this seat has won (血战: they sit out while the others play on). */
  win: WinRecord | null;
  /** Wins this hand (more than one only in 血流成河). */
  winCount?: number;
  handCount: number;
}

export function SeatCard({ info, score, voidSuit, dealer, active, win, winCount = win ? 1 : 0, handCount }: SeatCardProps) {
  const won = win !== null;
  return (
    <View style={[styles.card, active && styles.cardActive, won && styles.cardWon]}>
      <Text style={styles.avatar}>{info.avatar}</Text>
      <View style={styles.cardText}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {info.name}
          </Text>
          {!info.isHuman && <Text style={[styles.badge, styles.aiBadge]}>{T.aiBadge}</Text>}
          {dealer && <Text style={[styles.badge, styles.dealerBadge]}>{T.dealer}</Text>}
          {/* After a win the win line below says it all; the void suit no longer matters */}
          {voidSuit !== null && !won && <Text style={[styles.badge, styles.voidBadge]}>{T.voidSuit(SUIT_NAMES[voidSuit])}</Text>}
        </View>
        <Text style={[styles.score, score > 0 ? styles.plus : score < 0 ? styles.minus : null]}>
          {score > 0 ? `+${score}` : score}
          {!info.isHuman && !won ? `  · ${T.tilesInHand(handCount)}` : ''}
          {info.personality && !won ? <Text style={styles.personality}>{`  ${info.personality}`}</Text> : null}
        </Text>
        {win && (
          <View style={styles.winRow}>
            <Text style={styles.winText}>{winCount > 1 ? T.winTimes(winCount) : win.selfDraw ? T.zimo : T.hu}</Text>
            <Tile tile={win.tile} width={16} highlighted />
            <Text style={styles.winText}>{T.fan(win.fan)}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

/** Seconds left on the server timer, ticking locally. */
export function useCountdown(timer: TimerInfo | null, receivedAt: number): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!timer) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [timer, receivedAt]);
  if (!timer) return null;
  // `now` only ticks every 250 ms, so it can lag behind a freshly received snapshot.
  const elapsed = Math.max(0, now - receivedAt);
  return Math.max(0, Math.ceil((timer.remainingMs - elapsed) / 1000));
}

const styles = StyleSheet.create({
  backsRow: { flexDirection: 'row', gap: 1 },
  backsColumn: { flexDirection: 'column', gap: 1 },
  compass: {
    width: 112,
    height: 112,
    flexShrink: 0,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.32)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wind: { position: 'absolute', color: 'rgba(255,255,255,0.55)', fontSize: 13, fontWeight: '900' },
  windActive: { color: '#ffd54f', textShadowColor: '#ffb300', textShadowRadius: 8 },
  compassWall: { color: '#c8e6c9', fontSize: 11 },
  compassTimer: { color: '#fff', fontSize: 28, fontWeight: '900', fontVariant: ['tabular-nums'] },
  compassTimerLow: { color: '#ffab91' },
  melds: { flexDirection: 'row', gap: 6 },
  meld: { flexDirection: 'row' },
  pond: { alignContent: 'flex-start' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cardActive: { borderColor: '#ffd54f' },
  cardWon: { borderColor: '#ef5350', backgroundColor: 'rgba(120,20,20,0.55)' },
  winRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  winText: { color: '#ffcdd2', fontSize: 12, fontWeight: '900' },
  avatar: { fontSize: 26 },
  // Badges wrap under the name rather than pushing the card past the screen edge.
  cardText: { flexShrink: 1 },
  nameRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  name: { color: '#fff', fontWeight: '700', fontSize: 13, maxWidth: 90 },
  badge: { fontSize: 10, fontWeight: '800', paddingHorizontal: 4, borderRadius: 4, overflow: 'hidden' },
  dealerBadge: { backgroundColor: '#ffd54f', color: '#5d4100' },
  // AI-generated characters are always labelled as AI (Appendix D.4).
  aiBadge: { backgroundColor: '#80deea', color: '#004d55' },
  personality: { color: '#b2dfdb', fontSize: 11 },
  voidBadge: { backgroundColor: '#eceff1', color: '#37474f' },
  score: { color: '#e0f2e9', fontSize: 12, fontVariant: ['tabular-nums'] },
  plus: { color: '#ffe082' },
  minus: { color: '#ff8a80' },
});

/** An opponent's concealed tiles, seen from the back: a row across the top, a column on the sides. */
export function ConcealedTiles({ count, width, vertical }: { count: number; width: number; vertical?: boolean }) {
  if (count <= 0) return null;
  return (
    <View style={vertical ? styles.backsColumn : styles.backsRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: count }, (_, i) => (
        <Tile key={i} tile={null} back width={width} rotated={vertical} />
      ))}
    </View>
  );
}

/** Seat winds around the wall count and timer; the edge of the player to act lights up. */
export function Compass({ winds, active, wallCount, timer }: { winds: string[]; active: number | null; wallCount: string; timer: number | null }) {
  // winds[i] / active use sides: 0 = me (bottom), 1 = right, 2 = top, 3 = left.
  const edge = (side: number) => [styles.wind, WIND_POSITION[side], active === side && styles.windActive];
  return (
    <View style={styles.compass}>
      {[0, 1, 2, 3].map((side) => (
        <Text key={side} style={edge(side)}>
          {winds[side]}
        </Text>
      ))}
      <Text style={styles.compassWall}>{wallCount}</Text>
      {timer !== null && <Text style={[styles.compassTimer, timer <= 5 && styles.compassTimerLow]}>{timer}</Text>}
    </View>
  );
}

const WIND_POSITION = [
  { bottom: 2, alignSelf: 'center' },
  { right: 4, top: '40%' },
  { top: 2, alignSelf: 'center' },
  { left: 4, top: '40%' },
] as const;
