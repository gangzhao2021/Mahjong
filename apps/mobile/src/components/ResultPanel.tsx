/** Hand / game settlement overlay. */
import { patternFan, type HandResult, type Pattern, type Seat, type WinRecord } from '@mahjong/engine';
import type { TableSnapshot } from '@mahjong/protocol';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { PATTERN_NAMES, PAYMENT_NAMES, T } from '../strings';
import { Btn } from './ActionBar';
import { PopIn } from './PopIn';
import { Tile } from './Tile';

interface Props {
  table: TableSnapshot;
  result: HandResult;
  countdown: number | null;
  /** Coins settled for this hand, once the wallet update has arrived. */
  handCoins: number | null;
  gameCoins: number;
  onNextHand(): void;
  onNewGame(): void;
  onHome(): void;
}

export function ResultPanel({ table, result, countdown, handCoins, gameCoins, onNextHand, onNewGame, onHome }: Props) {
  const name = (seat: Seat) => table.seats[seat].name;
  const draw = result.drawSettlement;
  const tag = (seat: Seat) => {
    if (!draw) return '';
    if (draw.huaZhu.includes(seat)) return T.huaZhu;
    if (draw.ready.includes(seat)) return T.ready;
    if (draw.notReady.includes(seat)) return T.notReady;
    return '';
  };

  return (
    <View style={styles.backdrop}>
      <View style={styles.panel}>
        <Text style={styles.title}>
          {table.gameOver ? T.gameResult : T.handResult} · {T.hand(table.handIndex, table.handsPerGame)} ·{' '}
          {result.reason === 'threeWon' ? T.threeWon : T.wallExhausted}
        </Text>
        {/* Coins spring in once the wallet update arrives */}
        {table.stake.multiplier > 0 && handCoins !== null && (
          <PopIn key={handCoins} from={1.8} style={[styles.coinBadge, handCoins < 0 && styles.coinLoss]}>
            <Text style={styles.coins}>
              🪙 {T.handCoins(handCoins)}
              {table.gameOver ? `   ${T.gameCoins(gameCoins)}` : ''}
            </Text>
          </PopIn>
        )}
        <ScrollView style={styles.scroll} contentContainerStyle={{ gap: 6 }}>
          {result.wins.map((w) => (
            <View key={w.order} style={styles.win}>
              <Text style={styles.winText}>
                {name(w.seat)} {w.selfDraw ? T.zimo : `${T.hu}${T.dealtInBy(name(w.from!))}`}
              </Text>
              {/* Each pattern with the fan it adds, then the total and who pays */}
              <View style={styles.patternRow}>
                {w.patterns.map((p, i) => (
                  <Text key={i} style={styles.pattern}>
                    {PATTERN_NAMES[p]} {patternLabel(p)}
                  </Text>
                ))}
              </View>
              <Text style={styles.payLine}>
                {fanSummary(w)} → {w.selfDraw ? T.paysEach(w.score) : T.paysOne(name(w.from!), w.score)}
              </Text>
              <View style={styles.tiles}>
                {w.hand.map((t, i) => (
                  <Tile key={i} tile={t} width={20} highlighted={t === w.tile && i === w.hand.lastIndexOf(t)} />
                ))}
              </View>
            </View>
          ))}
          {result.payments
            .filter((p) => p.reason !== 'win')
            .map((p, i) => (
              <Text key={i} style={styles.details}>
                • {T.paymentExplain[p.reason]?.(name(p.from), name(p.to), p.amount) ?? `${PAYMENT_NAMES[p.reason]}${T.colon}${name(p.from)} → ${name(p.to)} ${p.amount}`}
              </Text>
            ))}
          <View style={styles.scores}>
            {table.seats.map((s) => {
              const delta = result.deltas[s.seat];
              return (
                <View key={s.seat} style={styles.scoreRow}>
                  <Text style={styles.cell}>
                    {s.avatar} {s.name}
                    {s.isHuman ? T.me : ''} {tag(s.seat)}
                  </Text>
                  <Text style={[styles.num, delta > 0 ? styles.plus : delta < 0 ? styles.minus : null]}>
                    {delta > 0 ? `+${delta}` : delta}
                  </Text>
                  <Text style={styles.total}>{table.totals[s.seat]}</Text>
                </View>
              );
            })}
          </View>
        </ScrollView>
        <View style={styles.buttons}>
          {table.gameOver ? (
            <>
              <Btn label={T.backHome} onPress={onHome} />
              <Btn label={T.newGame} primary onPress={onNewGame} />
            </>
          ) : (
            <Btn label={countdown !== null ? `${T.nextHand} (${countdown})` : T.nextHand} primary onPress={onNextHand} />
          )}
        </View>
      </View>
    </View>
  );
}

function patternLabel(p: Pattern): string {
  const fan = patternFan(p);
  if (fan !== null) return fan > 0 ? `+${T.patternFan(fan)}` : '';
  return p === 'ziMo' ? '' : T.maxFanPattern;
}

/** "3 番", or "4 番（封顶 4 番）" when the patterns add up to more than the cap. */
function fanSummary(w: WinRecord): string {
  const raw = w.patterns.reduce((sum, p) => sum + (patternFan(p) ?? 0), 0);
  return raw > w.fan ? `${T.fan(w.fan)}（${T.fanCapped(w.fan)}）` : T.fan(w.fan);
}

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
  panel: {
    backgroundColor: '#fdfaf2',
    borderRadius: 16,
    padding: 16,
    width: '100%',
    maxWidth: 640,
    maxHeight: '100%',
    gap: 10,
  },
  title: { fontSize: 17, fontWeight: '800', color: '#3e2723' },
  coins: { fontSize: 17, fontWeight: '900', color: '#5d4100' },
  coinBadge: { alignSelf: 'flex-start', backgroundColor: '#ffe082', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 4 },
  coinLoss: { backgroundColor: '#ffccbc' },
  scroll: { flexGrow: 0 },
  win: { backgroundColor: '#fff3e0', borderRadius: 10, padding: 8, gap: 3 },
  winText: { fontWeight: '700', color: '#4e342e' },
  patternRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  pattern: { color: '#bf360c', fontSize: 12, fontWeight: '700', backgroundColor: '#ffe0b2', borderRadius: 6, paddingHorizontal: 6, overflow: 'hidden' },
  payLine: { color: '#4e342e', fontSize: 13 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 1 },
  details: { color: '#5d4037', fontSize: 13 },
  scores: { gap: 4, marginTop: 4 },
  scoreRow: { flexDirection: 'row', alignItems: 'center' },
  cell: { flex: 1, color: '#37474f' },
  num: { width: 70, textAlign: 'right', fontWeight: '800', fontVariant: ['tabular-nums'], color: '#455a64' },
  total: { width: 70, textAlign: 'right', color: '#78909c', fontVariant: ['tabular-nums'] },
  plus: { color: '#2e7d32' },
  minus: { color: '#c62828' },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
});
