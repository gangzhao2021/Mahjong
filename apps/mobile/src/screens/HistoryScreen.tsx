/** Stats, recent hands, and a move-by-move replay of any of them with every hand face up. */
import { apply, createHand, rankOf, suitOf, type Action, type HandState, type Seat, type Tile as TileKind } from '@mahjong/engine';
import type { CharacterRelation, HandHistoryEntry, HandReplay, PlayerStats } from '@mahjong/protocol';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Btn } from '../components/ActionBar';
import { Felt } from '../components/Felt';
import { Melds } from '../components/TableParts';
import { Tile } from '../components/Tile';
import { reviewHand, type ReviewNote } from '../game/review';
import { api } from '../net/api';
import { getLocale, RANK_NAMES, SUIT_NAMES, T } from '../strings';

export function HistoryScreen({ token, onClose }: { token: string; onClose(): void }) {
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [hands, setHands] = useState<HandHistoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [replay, setReplay] = useState<HandReplay | null>(null);
  const [relations, setRelations] = useState<CharacterRelation[]>([]);

  useEffect(() => {
    let live = true;
    Promise.all([api.stats(token), api.history(token), api.relationships(token).catch(() => ({ relations: [] }))])
      .then(([s, h, r]) => {
        if (!live) return;
        setStats(s);
        setHands(h.hands);
        setRelations(r.relations);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [token]);

  if (replay) return <ReplayView replay={replay} onClose={() => setReplay(null)} />;

  const open = (h: HandHistoryEntry) => {
    api.replay(token, h.gameId, h.handIndex).then(setReplay, () => setFailed(true));
  };
  const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');

  return (
    <Felt style={styles.root}>
      <View style={styles.header}>
        <Btn label={`‹ ${T.record.back}`} onPress={onClose} />
        <Text style={styles.title}>{T.record.title}</Text>
      </View>
      {failed && <Text style={styles.error}>{T.record.loadFailed}</Text>}
      {!stats || !hands ? (
        !failed && <ActivityIndicator color="#ffe082" style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.stats}>
            <Stat label={T.record.games} value={String(stats.gamesPlayed)} />
            <Stat label={T.record.hands} value={String(stats.handsPlayed)} />
            <Stat label={T.record.winRate} value={pct(stats.wins, stats.handsPlayed)} />
            <Stat label={T.record.selfDraws} value={String(stats.selfDraws)} />
            <Stat label={T.record.dealInRate} value={pct(stats.dealIns, stats.handsPlayed)} />
            <Stat label={T.record.bestFan} value={stats.bestFan === null ? '—' : T.fan(stats.bestFan)} />
          </View>
          {relations.length > 0 && (
            <>
              <Text style={styles.section}>
                {T.record.regulars}
                <Text style={styles.sectionHint}>{`  ${T.record.regularsHint}`}</Text>
              </Text>
              <View style={styles.regulars}>
                {relations.map((r) => (
                  <Regular key={r.characterId} r={r} />
                ))}
              </View>
            </>
          )}
          <Text style={styles.section}>{hands.length ? T.record.recent : T.record.empty}</Text>
          {hands.map((h) => {
            const delta = h.deltas[h.mySeat];
            return (
              <Pressable key={`${h.gameId}-${h.handIndex}`} onPress={() => open(h)} style={({ pressed }) => [styles.row, pressed && styles.pressed]} accessibilityRole="button">
                <Text style={styles.when}>{new Date(h.endedAt).toLocaleString()}</Text>
                <Text style={styles.hand}>{T.record.handOf(h.handIndex)}</Text>
                <Text style={styles.outcome}>{h.myWin ? T.record.won(h.myWin.fan, h.myWin.selfDraw) : h.reason === 'wallExhausted' ? T.wallExhausted : ''}</Text>
                <Text style={[styles.delta, delta > 0 ? styles.plus : delta < 0 ? styles.minus : null]}>{delta > 0 ? `+${delta}` : delta}</Text>
                <Text style={styles.arrow}>›</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </Felt>
  );
}

/** One AI character's card: how often you meet and who gets the better of whom. */
function Regular({ r }: { r: CharacterRelation }) {
  // A nemesis: at least a few hands together and they clearly have your number.
  const rival = r.handsTogether >= 8 && r.theirWins + r.iDealtIn >= 2 * (r.myWins + r.theyDealtIn) + 3;
  return (
    <View style={styles.regular}>
      <Text style={styles.regularAvatar}>{r.avatar}</Text>
      <View style={styles.regularText}>
        <Text style={styles.regularName}>
          {getLocale() === 'en' && r.nameEn ? r.nameEn : r.name}
          <Text style={[styles.bond, rival && styles.bondRival]}>{`  ${T.record.bond(r.handsTogether, rival)}`}</Text>
        </Text>
        <Text style={styles.regularLine}>{T.record.together(r.handsTogether)}</Text>
        <Text style={styles.regularLine}>{T.record.headToHead(r.myWins, r.theirWins)}</Text>
        <Text style={styles.regularLine}>{T.record.dealIns(r.iDealtIn, r.theyDealtIn)}</Text>
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const tileName = (t: TileKind) => `${RANK_NAMES[rankOf(t) - 1]}${SUIT_NAMES[suitOf(t)]}`;

function describe(a: Action, name: (s: Seat) => string): string {
  const r = T.replay;
  switch (a.type) {
    case 'swap':
      return r.swap(name(a.seat));
    case 'dingque':
      return r.dingque(name(a.seat), SUIT_NAMES[a.suit]);
    case 'discard':
      return r.discard(name(a.seat), tileName(a.tile));
    case 'selfKong':
      return r.selfKong(name(a.seat), tileName(a.tile));
    case 'pong':
      return r.pong(name(a.seat));
    case 'kong':
      return r.kong(name(a.seat));
    case 'hu':
      return r.hu(name(a.seat));
    case 'zimo':
      return r.zimo(name(a.seat));
    case 'pass':
      return r.pass(name(a.seat));
  }
}

/** Steps through the logged actions on a local copy of the hand; passes are skipped as steps of their own. */
function ReplayView({ replay, onClose }: { replay: HandReplay; onClose(): void }) {
  // Every state from the deal to the end, keeping only steps a viewer would notice.
  const steps = useMemo(() => {
    let state = createHand({ ruleSet: replay.ruleSet, baseScore: replay.baseScore, seed: replay.seed, dealer: replay.dealer });
    const out: { state: HandState; action: Action | null }[] = [{ state, action: null }];
    for (const action of replay.actions) {
      state = apply(state, action).state;
      if (action.type === 'pass') out[out.length - 1] = { ...out[out.length - 1], state };
      else out.push({ state, action });
    }
    return out;
  }, [replay]);
  const notes = useMemo(() => reviewHand(steps, replay.mySeat), [steps, replay.mySeat]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const last = steps.length - 1;
  // Playback stops by itself at the end of the hand.
  const running = playing && index < last;

  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => setIndex((i) => Math.min(last, i + 1)), 700);
    return () => clearTimeout(timer);
  }, [running, index, last]);

  const { state, action } = steps[index];
  const name = (s: Seat) => replay.seats[s]?.name ?? '';
  // My seat first, then around the table in turn order.
  const order = [0, 1, 2, 3].map((k) => ((replay.mySeat + k) % 4) as Seat);

  return (
    <Felt style={styles.root}>
      <View style={styles.header}>
        <Btn label={`‹ ${T.record.back}`} onPress={onClose} />
        <Text style={styles.title}>{T.replay.title(replay.handIndex)}</Text>
        <View style={styles.controls}>
          <Btn label="⏮" onPress={() => setIndex(0)} />
          <Btn label="◀" onPress={() => setIndex((i) => Math.max(0, i - 1))} />
          <Btn
            label={running ? T.replay.pause : T.replay.play}
            primary
            onPress={() => {
              if (!running && index >= last) setIndex(0);
              setPlaying(!running);
            }}
          />
          <Btn label="▶" onPress={() => setIndex((i) => Math.min(last, i + 1))} />
          <Btn label="⏭" onPress={() => setIndex(last)} />
          <Text style={styles.stepText}>{T.replay.step(index, last)}</Text>
        </View>
      </View>
      <Text style={styles.moveText}>{action ? describe(action, name) : T.replay.start}</Text>
      <ReviewBar notes={notes} index={index} onJump={(step) => {
        setPlaying(false);
        setIndex(step);
      }} />
      <ScrollView contentContainerStyle={styles.seats}>
        {order.map((seat) => {
          const p = state.players[seat];
          const acting = action?.seat === seat;
          return (
            <View key={seat} style={[styles.seat, acting && styles.seatActing, p.won && styles.seatWon]}>
              <View style={styles.seatInfo}>
                <Text style={styles.seatName} numberOfLines={1}>
                  {name(seat)}
                  {seat === state.dealer ? ` · ${T.dealer}` : ''}
                </Text>
                <Text style={styles.seatSub}>
                  {p.voidSuit !== null ? T.voidSuit(SUIT_NAMES[p.voidSuit]) : ''}
                  {p.won ? ` · ${p.won.selfDraw ? T.zimo : T.hu} ${T.fan(p.won.fan)}` : ''}
                </Text>
              </View>
              <View style={styles.seatTiles}>
                <View style={styles.handRow}>
                  {p.hand.map((t, i) => (
                    <Tile key={i} tile={t} width={24} />
                  ))}
                  <Melds melds={p.melds} tileWidth={20} />
                </View>
                <View style={styles.pondRow}>
                  {p.discards.map((d, i) => (
                    <Tile key={i} tile={d.tile} width={16} dimmed={d.claimed} highlighted={acting && action?.type === 'discard' && i === p.discards.length - 1} />
                  ))}
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </Felt>
  );
}

/** The review points as chips (tap to jump), and the explanation for the move on screen. */
function ReviewBar({ notes, index, onJump }: { notes: ReviewNote[]; index: number; onJump(step: number): void }) {
  const current = notes.find((n) => n.step === index);
  return (
    <View style={styles.review}>
      <Text style={styles.reviewTitle}>
        {T.review.title}
        {notes.length ? <Text style={styles.reviewHint}>{`  ${T.review.hint}`}</Text> : null}
      </Text>
      {notes.length === 0 ? (
        <Text style={styles.reviewText}>{T.review.none}</Text>
      ) : (
        <View style={styles.reviewChips}>
          {notes.map((n) => (
            <Pressable key={n.step} onPress={() => onJump(n.step)} style={[styles.reviewChip, n.step === index && styles.reviewChipOn]} accessibilityRole="button">
              <Text style={[styles.reviewChipText, n.step === index && styles.reviewChipTextOn]}>{T.review.chip(n.step, tileName(n.played), tileName(n.better))}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {current && (
        <Text style={styles.reviewText}>
          {current.kind === 'shanten'
            ? T.review.shanten(tileName(current.played), tileName(current.better))
            : T.review.acceptance(tileName(current.played), tileName(current.better), current.playedAcceptance, current.betterAcceptance)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  title: { color: '#fff8e1', fontSize: 20, fontWeight: '900', flex: 1 },
  error: { color: '#ffab91', fontWeight: '700' },
  body: { gap: 10, paddingBottom: 20, maxWidth: 900, width: '100%', alignSelf: 'center' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: { flexGrow: 1, flexBasis: 120, backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  statValue: { color: '#ffe082', fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] },
  statLabel: { color: '#c8e6c9', fontSize: 12, fontWeight: '700' },
  section: { color: '#e8f5e9', fontWeight: '800', marginTop: 6 },
  sectionHint: { color: '#a5d6a7', fontWeight: '600', fontSize: 12 },
  regulars: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  regular: { flexGrow: 1, flexBasis: 220, flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 12, padding: 10 },
  regularAvatar: { fontSize: 32 },
  regularText: { flex: 1, gap: 1 },
  regularName: { color: '#fff', fontWeight: '900' },
  bond: { color: '#a5d6a7', fontSize: 12, fontWeight: '800' },
  bondRival: { color: '#ff8a80' },
  regularLine: { color: '#c8e6c9', fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  pressed: { opacity: 0.7 },
  when: { color: '#a5d6a7', fontSize: 12, width: 150 },
  hand: { color: '#fff', fontWeight: '700', width: 70 },
  outcome: { color: '#ffe082', fontWeight: '800', flex: 1 },
  delta: { color: '#e0f2e9', fontWeight: '900', width: 50, textAlign: 'right', fontVariant: ['tabular-nums'] },
  plus: { color: '#ffe082' },
  minus: { color: '#ff8a80' },
  arrow: { color: '#a5d6a7', fontSize: 20 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepText: { color: '#c8e6c9', fontVariant: ['tabular-nums'], minWidth: 60 },
  moveText: { color: '#ffe082', fontSize: 16, fontWeight: '800', alignSelf: 'center' },
  seats: { gap: 8, paddingBottom: 20 },
  review: { backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 12, padding: 8, gap: 6 },
  reviewTitle: { color: '#ffe082', fontWeight: '900' },
  reviewHint: { color: '#a5d6a7', fontWeight: '600', fontSize: 12 },
  reviewText: { color: '#fff8e1', fontSize: 14, fontWeight: '700' },
  reviewChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reviewChip: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: 'rgba(255,255,255,0.12)' },
  reviewChipOn: { backgroundColor: '#ffd54f' },
  reviewChipText: { color: '#e8f5e9', fontSize: 12, fontWeight: '700' },
  reviewChipTextOn: { color: '#3e2723' },
  seat: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: 8, borderWidth: 2, borderColor: 'transparent' },
  seatActing: { borderColor: '#ffd54f' },
  seatWon: { backgroundColor: 'rgba(120,20,20,0.45)' },
  seatInfo: { width: 130 },
  seatName: { color: '#fff', fontWeight: '800' },
  seatSub: { color: '#ffcdd2', fontSize: 12, fontWeight: '700' },
  seatTiles: { flex: 1, gap: 4 },
  handRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 1, flexWrap: 'wrap' },
  pondRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 1 },
});
