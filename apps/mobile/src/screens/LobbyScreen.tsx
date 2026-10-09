/** Lobby: coins, daily reward, table selection and private rooms (PRD §10–§13, §24). */
import type { AccountSummary, FriendRoomInfo, GameOptions, PrivateRules, ServerInfo } from '@mahjong/protocol';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Btn } from '../components/ActionBar';
import { Felt } from '../components/Felt';
import { formStyles, Sheet } from '../components/Sheet';
import { SettingsSheet } from './SettingsSheet';
import { updateSettings, useSettings } from '../settings';
import { AchievementsSheet } from './AchievementsSheet';
import { FriendRoomEntrySheet, WaitingRoomSheet, type FriendActions } from './FriendRoomSheet';
import { TileFan } from '../components/TileFan';
import type { ConnectionStatus } from '../net/useGame';
import { T, tableName } from '../strings';

interface Props {
  info: ServerInfo;
  token: string;
  account: AccountSummary;
  status: ConnectionStatus;
  onAccount(account: AccountSummary): void;
  onStart(options: GameOptions): void;
  onOpenAccount(): void;
  onOpenTutorial(): void;
  onOpenHistory(): void;
  onOpenRules(): void;
  /** Friend-room waiting room (null when not in one) and its actions. */
  friendRoom: FriendRoomInfo | null;
  friend: FriendActions;
  /** Lessons the player has finished (from local storage). */
  tutorialDone: number;
}

/** Chip colours per stake level (fill, dashed rim, label), so the tables read as a ladder at a glance. */
const TIER: Record<string, { fill: string; rim: string; ink: string }> = {
  practice: { fill: '#43a047', rim: '#c8e6c9', ink: '#fff' },
  low: { fill: '#1e88e5', rim: '#bbdefb', ink: '#fff' },
  mid: { fill: '#8e24aa', rim: '#e1bee7', ink: '#fff' },
  high: { fill: '#e0a100', rim: '#ffecb3', ink: '#3e2a00' },
};
const TIER_FALLBACK = { fill: '#607d8b', rim: '#cfd8dc', ink: '#fff' };
const LESSON_COUNT = 6;

export function LobbyScreen({ info, token, account, status, onAccount, onStart, onOpenAccount, onOpenTutorial, onOpenHistory, onOpenRules, friendRoom, friend, tutorialDone }: Props) {
  const [privateOpen, setPrivateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [achievementsOpen, setAchievementsOpen] = useState(false);
  const [friendOpen, setFriendOpen] = useState(false);
  const { width, height } = useWindowDimensions();
  const online = status === 'online';
  const limit = account.playLimit;
  const blocked = limit !== null && limit.until === null;
  const compact = width < 700;

  // Quick start: new players go to practice; others to the highest table they can comfortably afford (10× the entry).
  // Quick start goes back to the table played last, or the closest cheaper one the player can still afford.
  // It never moves anyone up to higher stakes on its own; new players start at practice.
  const { lastTableId, bindReminderSnoozedUntil } = useSettings();
  // Guests who keep playing get a quiet reminder to link an account; "not now" hides it for a week.
  const [now] = useState(() => Date.now());
  const remindBind = account.isGuest && account.gamesPlayed >= 2 && bindReminderSnoozedUntil < now;
  const lastIndex = Math.max(0, info.tables.findIndex((t) => t.id === lastTableId));
  const affordable = info.tables.slice(0, lastIndex + 1).filter((t) => account.balance >= t.minCoins);
  const quick = tutorialDone >= 0 && tutorialDone < 2 && !lastTableId ? info.tables[0] : (affordable[affordable.length - 1] ?? info.tables[0]);
  const play = (tableId: string) => {
    updateSettings({ lastTableId: tableId });
    onStart({ tableId });
  };
  const fanTile = Math.round(Math.min(height * 0.15, 72));
  // Cards size to the screen but stop growing on big monitors, so they never turn into empty slabs.
  const cardHeight = Math.round(Math.max(64, Math.min(height * 0.17, 128)));
  const chipSize = Math.round(Math.min(cardHeight * 0.62, 60));

  return (
    <Felt style={styles.root}>
      <View style={[styles.top, styles.capped]}>
        <Pressable style={styles.profile} onPress={onOpenAccount} accessibilityRole="button" accessibilityLabel={T.account}>
          <Text style={styles.avatar}>{account.avatar}</Text>
          <View>
            <Text style={styles.nickname} numberOfLines={1}>
              {account.nickname}
            </Text>
            <Text style={styles.coins}>🪙 {account.balance.toLocaleString()}</Text>
            <Text style={styles.rank}>🏅 {T.rank.label(T.rank.tiers[account.rank.tier], account.rank.points)}</Text>
          </View>
        </Pressable>
        <View style={styles.topButtons}>
          <Btn label={`📊 ${T.record.entry}`} onPress={onOpenHistory} />
          {/* Rewards pay themselves, so this is just a place to look, with no badge nagging */}
          <Btn label={`🏆 ${T.achievements.entry}`} onPress={() => setAchievementsOpen(true)} />
          <Btn label={`⚙️ ${T.settings.entry}`} onPress={() => setSettingsOpen(true)} />
          <Btn label={`👤 ${T.account}`} onPress={onOpenAccount} />
        </View>
      </View>

      {remindBind && (
        <View style={[styles.bind, styles.capped]}>
          <Text style={styles.bindText}>🔐 {T.bindReminder.text}</Text>
          <Btn label={T.bindReminder.bind} primary onPress={onOpenAccount} />
          <Btn label={T.bindReminder.later} onPress={() => updateSettings({ bindReminderSnoozedUntil: Date.now() + 7 * 24 * 3600_000 })} />
        </View>
      )}

      {(limit || !online) && (
        <Text style={styles.limit}>
          {!online ? (status === 'connecting' ? T.connecting : T.offline) : limit!.kind === 'minor' ? T.minorLimit(limit!.until) : T.guestLimit(limit!.until)}
        </Text>
      )}

      <View style={[styles.body, styles.capped]}>
        {/* Left: the game's face and the one-tap way in */}
        <View style={[styles.hero, compact && styles.heroCompact]}>
          {/* The decorative fan gives way on short screens when the reminder takes a row */}
          {!compact && !(remindBind && height < 480) && <TileFan width={fanTile} />}
          <Text style={styles.brand}>{T.brand}</Text>
          <Text style={styles.brandSub}>{T.brandSub}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={!online || blocked}
            onPress={() => play(quick.id)}
            style={({ pressed }) => [styles.quick, (!online || blocked) && styles.disabled, pressed && styles.pressed]}
          >
            <Text style={styles.quickText}>▶ {T.quickStart}</Text>
            <Text style={styles.quickSub}>
              {tableName(quick)} · {quick.multiplier === 0 ? T.noCoins : T.baseScoreN(quick.baseScore)}
            </Text>
          </Pressable>
          <View style={styles.chips}>
            <Pressable onPress={onOpenTutorial} style={[styles.chip, tutorialDone === 0 && styles.chipHot]} accessibilityRole="button">
              <Text style={[styles.chipText, tutorialDone === 0 && styles.chipHotText]}>📖 {T.tutorialProgress(Math.max(0, tutorialDone), LESSON_COUNT)}</Text>
            </Pressable>
            <Pressable onPress={onOpenRules} style={styles.chip} accessibilityRole="button">
              <Text style={styles.chipText}>📘 {T.rulesPage.entry}</Text>
            </Pressable>
          </View>
        </View>

        {/* Right: every table, filling the space */}
        <View style={styles.tablesArea}>
          <Text style={styles.heading}>{T.tables}</Text>
          <View style={styles.grid}>
            {info.tables.map((t) => {
              const affordable = account.balance >= t.minCoins;
              const tier = TIER[t.id] ?? TIER_FALLBACK;
              return (
                <Pressable
                  key={t.id}
                  accessibilityRole="button"
                  disabled={!online || blocked || !affordable}
                  onPress={() => play(t.id)}
                  style={({ pressed }) => [styles.card, { minHeight: cardHeight }, (!affordable || blocked) && styles.disabled, pressed && styles.pressed]}
                >
                  {t.id === quick.id && (
                    <Text style={[styles.badge, { backgroundColor: tier.fill, color: tier.ink }]} numberOfLines={1}>
                      {T.recommended}
                    </Text>
                  )}
                  {/* Poker chip carrying the base score; the practice table has none, so it shows the table's initial */}
                  <View
                    style={[
                      styles.stake,
                      { width: chipSize, height: chipSize, borderRadius: chipSize / 2, backgroundColor: tier.fill, borderColor: tier.rim },
                    ]}
                  >
                    <Text style={[styles.stakeLabel, { color: tier.ink, fontSize: Math.round(chipSize * 0.32) }]} numberOfLines={1}>
                      {t.multiplier === 0 ? tableName(t).slice(0, 1) : t.baseScore}
                    </Text>
                  </View>
                  <View style={styles.cardBody}>
                    <Text style={styles.cardName} numberOfLines={1}>
                      {tableName(t)}
                    </Text>
                    <Text style={[styles.cardInfo, !affordable && styles.short]} numberOfLines={1}>
                      {!affordable
                        ? `🔒 ${T.needMore(t.minCoins - account.balance)}`
                        : t.multiplier === 0
                          ? T.noCoins
                          : `${T.baseScoreN(t.baseScore)} · ${T.minCoinsN(t.minCoins)}`}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          {/* Two ways to set up a table yourself: alone with AI, or with friends */}
          <View style={styles.roomRow}>
            <Pressable
              accessibilityRole="button"
              disabled={!online || blocked}
              onPress={() => setPrivateOpen(true)}
              style={({ pressed }) => [styles.private, blocked && styles.disabled, pressed && styles.pressed]}
            >
              <Text style={styles.privateName}>🏠 {T.privateRoom}</Text>
              <Text style={styles.privateInfo} numberOfLines={1}>
                {T.privateRoomHint}
              </Text>
              <Text style={styles.privateArrow}>›</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!online || blocked}
              onPress={() => setFriendOpen(true)}
              style={({ pressed }) => [styles.private, blocked && styles.disabled, pressed && styles.pressed]}
            >
              <Text style={styles.privateName}>👥 {T.friend.entry}</Text>
              <Text style={styles.privateInfo} numberOfLines={1}>
                {T.friend.hint}
              </Text>
              <Text style={styles.privateArrow}>›</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
      {friendRoom ? (
        <WaitingRoomSheet room={friendRoom} myId={account.playerId} actions={friend} />
      ) : (
        friendOpen && <FriendRoomEntrySheet maxHands={info.privateRoom.maxHands} actions={friend} onClose={() => setFriendOpen(false)} />
      )}
      {achievementsOpen && <AchievementsSheet token={token} account={account} onAccount={onAccount} onClose={() => setAchievementsOpen(false)} />}
      {privateOpen && (
        <PrivateRoomSheet
          info={info}
          balance={account.balance}
          onClose={() => setPrivateOpen(false)}
          onCreate={(options) => {
            setPrivateOpen(false);
            onStart(options);
          }}
        />
      )}
    </Felt>
  );
}

const DEFAULT_RULES: PrivateRules = {
  huanSanZhang: true,
  maxFan: 4,
  selfDrawBonus: 'base',
  callTransfer: true,
  jinGouDiao: true,
  jiangDui: true,
  tianDiHu: true,
  haiDi: true,
  gangShangPao: true,
  qiangGang: true,
  xueliu: false,
};

function PrivateRoomSheet({ info, balance, onClose, onCreate }: { info: ServerInfo; balance: number; onClose(): void; onCreate(o: GameOptions): void }) {
  const maxBase = Math.max(0, Math.min(Math.floor(balance * info.privateRoom.maxBaseRatio), info.privateRoom.maxBase));
  const [base, setBase] = useState(String(Math.min(10, maxBase)));
  const [hands, setHands] = useState(4);
  const [rules, setRules] = useState<PrivateRules>(DEFAULT_RULES);
  const baseNum = Number(base);
  const valid = Number.isInteger(baseNum) && baseNum >= 0 && baseNum <= maxBase;
  const toggle = (key: 'huanSanZhang' | 'callTransfer' | 'xueliu') => setRules((r) => ({ ...r, [key]: !r[key] }));

  return (
    <Sheet title={T.privateRoom} onClose={onClose}>
      <View style={formStyles.row}>
        <Text style={formStyles.label}>{T.baseScore}</Text>
        <TextInput style={formStyles.input} value={base} onChangeText={(v) => setBase(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={7} />
      </View>
      <Text style={[formStyles.hint, !valid && formStyles.error]}>{T.maxBaseHint(maxBase)}</Text>
      <View style={formStyles.row}>
        <Text style={formStyles.label}>{T.hands}</Text>
        <Btn label="−" onPress={() => setHands((h) => Math.max(1, h - 1))} />
        <Text style={styles.stepper}>{hands}</Text>
        <Btn label="+" onPress={() => setHands((h) => Math.min(info.privateRoom.maxHands, h + 1))} />
      </View>
      <View style={formStyles.row}>
        <Text style={formStyles.label}>{T.rules.maxFan}</Text>
        {[3, 4, 5, 6].map((n) => (
          <Btn key={n} label={`${n}`} primary={rules.maxFan === n} onPress={() => setRules((r) => ({ ...r, maxFan: n }))} />
        ))}
      </View>
      <RuleSwitch label={T.rules.huanSanZhang} value={rules.huanSanZhang} onChange={() => toggle('huanSanZhang')} />
      <RuleSwitch label={T.rules.xueliu} value={rules.xueliu} onChange={() => toggle('xueliu')} />
      <RuleSwitch label={T.rules.callTransfer} value={rules.callTransfer} onChange={() => toggle('callTransfer')} />
      <RuleSwitch
        label={T.rules.selfDrawFan}
        value={rules.selfDrawBonus === 'fan'}
        onChange={() => setRules((r) => ({ ...r, selfDrawBonus: r.selfDrawBonus === 'fan' ? 'base' : 'fan' }))}
      />
      <Btn label={T.privateCreate} primary disabled={!valid} onPress={() => onCreate({ private: { baseScore: baseNum, handsPerGame: hands, rules } })} />
    </Sheet>
  );
}

function RuleSwitch({ label, value, onChange }: { label: string; value: boolean; onChange(): void }) {
  return (
    <View style={formStyles.row}>
      <Switch value={value} onValueChange={onChange} />
      <Text style={formStyles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  topButtons: { flexDirection: 'row', gap: 6, flexShrink: 1, flexWrap: 'wrap', justifyContent: 'flex-end' },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 10,
    maxWidth: 220,
  },
  avatar: { fontSize: 30 },
  nickname: { color: '#fff', fontWeight: '800', fontSize: 15 },
  coins: { color: '#ffe082', fontWeight: '800', fontVariant: ['tabular-nums'] },
  rank: { color: '#b2dfdb', fontSize: 12, fontWeight: '800' },
  limit: { color: '#ffcc80', fontSize: 13, alignSelf: 'center' },
  bind: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  bindText: { flex: 1, color: '#e8f5e9', fontSize: 13 },
  capped: { width: '100%', maxWidth: 1180, alignSelf: 'center' },
  body: { flex: 1, flexDirection: 'row', gap: 24, minHeight: 0 },
  hero: { flex: 0.85, alignItems: 'center', justifyContent: 'center', gap: 6 },
  heroCompact: { flex: 0.75 },
  brand: {
    color: '#fff8e1',
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 2,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowRadius: 6,
    textShadowOffset: { width: 0, height: 2 },
  },
  brandSub: { color: '#ffd54f', fontSize: 15, fontWeight: '800', letterSpacing: 6, marginTop: -4 },
  quick: {
    marginTop: 6,
    backgroundColor: '#ffca28',
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 26,
    alignItems: 'center',
    borderBottomWidth: 4,
    borderBottomColor: '#c79100',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  quickText: { color: '#3e2723', fontSize: 20, fontWeight: '900' },
  quickSub: { color: '#5d4037', fontSize: 12, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 4 },
  chip: { backgroundColor: 'rgba(0,0,0,0.28)', borderRadius: 12, paddingVertical: 4, paddingHorizontal: 10 },
  chipHot: { backgroundColor: '#ffd54f' },
  chipText: { color: '#e8f5e9', fontSize: 12, fontWeight: '700' },
  chipHotText: { color: '#5d4100' },
  tablesArea: { flex: 1.25, gap: 8, minHeight: 0, justifyContent: 'center' },
  heading: { color: '#e8f5e9', fontSize: 14, fontWeight: '800' },
  grid: { flexShrink: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: {
    flexGrow: 1,
    flexBasis: '45%',
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.16)',
    borderWidth: 1.5,
    borderColor: 'rgba(129,199,132,0.55)',
    borderStyle: 'dashed',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
  },
  stake: { borderWidth: 4, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  stakeLabel: { fontWeight: '900', fontVariant: ['tabular-nums'] },
  cardBody: { flex: 1, paddingVertical: 8, justifyContent: 'center', gap: 3 },
  cardName: { fontSize: 17, fontWeight: '900', color: '#fff8e1' },
  badge: { position: 'absolute', top: -8, right: 10, fontSize: 10, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8, overflow: 'hidden' },
  cardInfo: { fontSize: 12, color: '#a5d6a7', fontWeight: '700' },
  roomRow: { flexDirection: 'row', gap: 10 },
  private: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(0,0,0,0.16)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,213,79,0.55)',
    borderStyle: 'dashed',
  },
  privateName: { fontSize: 16, fontWeight: '900', color: '#ffe082' },
  privateInfo: { flex: 1, fontSize: 12, color: 'rgba(232,245,233,0.7)' },
  privateArrow: { fontSize: 24, color: '#ffe082', fontWeight: '700' },
  disabled: { opacity: 0.5 },
  pressed: { transform: [{ scale: 0.97 }] },
  short: { color: '#ffab91' },
  stepper: { fontSize: 18, fontWeight: '800', minWidth: 30, textAlign: 'center' },
});
