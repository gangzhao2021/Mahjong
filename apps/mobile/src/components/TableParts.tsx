/** Small presentational pieces of the table: melds, ponds, seat cards, countdown. */
import type { DiscardRecord, Meld, Suit } from '@mahjong/engine';
import type { SeatInfo, TimerInfo } from '@mahjong/protocol';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SUIT_NAMES, T } from '../strings';
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

export function Pond({ discards, tileWidth, perRow, lastDiscard }: { discards: DiscardRecord[]; tileWidth: number; perRow: number; lastDiscard: boolean }) {
  const visible = discards.filter((d) => !d.claimed);
  return (
    <View style={[styles.pond, { width: perRow * (tileWidth + 2) }]}>
      {visible.map((d, i) => (
        <Tile key={i} tile={d.tile} width={tileWidth} highlighted={lastDiscard && i === visible.length - 1} style={{ margin: 1 }} />
      ))}
    </View>
  );
}

interface SeatCardProps {
  info: SeatInfo;
  score: number;
  voidSuit: Suit | null;
  dealer: boolean;
  active: boolean;
  won: boolean;
  handCount: number;
}

export function SeatCard({ info, score, voidSuit, dealer, active, won, handCount }: SeatCardProps) {
  return (
    <View style={[styles.card, active && styles.cardActive]}>
      <Text style={styles.avatar}>{info.avatar}</Text>
      <View>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {info.name}
          </Text>
          {!info.isHuman && <Text style={[styles.badge, styles.aiBadge]}>{T.aiBadge}</Text>}
          {dealer && <Text style={[styles.badge, styles.dealerBadge]}>{T.dealer}</Text>}
          {voidSuit !== null && <Text style={[styles.badge, styles.voidBadge]}>缺{SUIT_NAMES[voidSuit]}</Text>}
          {won && <Text style={[styles.badge, styles.wonBadge]}>{T.hu}</Text>}
        </View>
        <Text style={[styles.score, score > 0 ? styles.plus : score < 0 ? styles.minus : null]}>
          {score > 0 ? `+${score}` : score}
          {!info.isHuman && !won ? `  · ${handCount}张` : ''}
          {info.personality ? <Text style={styles.personality}>{`  ${info.personality}`}</Text> : null}
        </Text>
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
  melds: { flexDirection: 'row', gap: 6 },
  meld: { flexDirection: 'row' },
  pond: { flexDirection: 'row', flexWrap: 'wrap', alignContent: 'flex-start' },
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
  avatar: { fontSize: 26 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { color: '#fff', fontWeight: '700', fontSize: 13, maxWidth: 90 },
  badge: { fontSize: 10, fontWeight: '800', paddingHorizontal: 4, borderRadius: 4, overflow: 'hidden' },
  dealerBadge: { backgroundColor: '#ffd54f', color: '#5d4100' },
  // AI-generated characters are always labelled as AI (Appendix D.4).
  aiBadge: { backgroundColor: '#80deea', color: '#004d55' },
  personality: { color: '#b2dfdb', fontSize: 11 },
  voidBadge: { backgroundColor: '#eceff1', color: '#37474f' },
  wonBadge: { backgroundColor: '#e53935', color: '#fff' },
  score: { color: '#e0f2e9', fontSize: 12, fontVariant: ['tabular-nums'] },
  plus: { color: '#ffe082' },
  minus: { color: '#ff8a80' },
});
