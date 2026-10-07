/** Lobby: coins, daily reward, table selection and private rooms (PRD §10–§13, §24). */
import type { AccountSummary, GameOptions, PrivateRules, ServerInfo } from '@mahjong/protocol';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Btn } from '../components/ActionBar';
import { formStyles, Sheet } from '../components/Sheet';
import { api } from '../net/api';
import type { ConnectionStatus } from '../net/useGame';
import { T } from '../strings';

interface Props {
  info: ServerInfo;
  token: string;
  account: AccountSummary;
  status: ConnectionStatus;
  onAccount(account: AccountSummary): void;
  onStart(options: GameOptions): void;
  onOpenAccount(): void;
}

export function LobbyScreen({ info, token, account, status, onAccount, onStart, onOpenAccount }: Props) {
  const [rewardOpen, setRewardOpen] = useState(false);
  const [privateOpen, setPrivateOpen] = useState(false);
  const online = status === 'online';
  const limit = account.playLimit;
  const blocked = limit !== null && limit.until === null;

  return (
    <View style={styles.root}>
      <View style={styles.top}>
        <Pressable style={styles.profile} onPress={onOpenAccount} accessibilityRole="button">
          <Text style={styles.avatar}>{account.avatar}</Text>
          <View>
            <Text style={styles.nickname}>{account.nickname}</Text>
            <Text style={styles.coins}>🪙 {account.balance.toLocaleString()}</Text>
          </View>
        </Pressable>
        <View style={formStyles.row}>
          <Btn label={account.reward.claimable ? `🎁 ${T.dailyReward}` : T.dailyReward} primary={account.reward.claimable} onPress={() => setRewardOpen(true)} />
          <Btn label={T.account} onPress={onOpenAccount} />
        </View>
      </View>

      {limit && <Text style={styles.limit}>{limit.kind === 'minor' ? T.minorLimit(limit.until) : T.guestLimit(limit.until)}</Text>}
      {!online && <Text style={styles.limit}>{status === 'connecting' ? T.connecting : T.offline}</Text>}

      <Text style={styles.heading}>{T.tables}</Text>
      <View style={styles.tables}>
        {info.tables.map((t) => {
          const affordable = account.balance >= t.minCoins;
          return (
            <Pressable
              key={t.id}
              accessibilityRole="button"
              disabled={!online || blocked || !affordable}
              onPress={() => onStart({ tableId: t.id })}
              style={({ pressed }) => [styles.table, (!affordable || blocked) && styles.disabled, pressed && styles.pressed]}
            >
              <Text style={styles.tableName}>{t.name}</Text>
              <Text style={styles.tableInfo}>{t.multiplier === 0 ? T.noCoins : T.baseScoreN(t.baseScore)}</Text>
              {t.minCoins > 0 && <Text style={[styles.tableInfo, !affordable && styles.short]}>{T.minCoinsN(t.minCoins)}</Text>}
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          disabled={!online || blocked}
          onPress={() => setPrivateOpen(true)}
          style={({ pressed }) => [styles.table, styles.privateCard, blocked && styles.disabled, pressed && styles.pressed]}
        >
          <Text style={styles.tableName}>{T.privateRoom}</Text>
          <Text style={styles.tableInfo}>{T.privateRoomHint}</Text>
        </Pressable>
      </View>

      {rewardOpen && <RewardSheet token={token} account={account} onAccount={onAccount} onClose={() => setRewardOpen(false)} />}
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
    </View>
  );
}

function RewardSheet({ token, account, onAccount, onClose }: { token: string; account: AccountSummary; onAccount(a: AccountSummary): void; onClose(): void }) {
  const [busy, setBusy] = useState(false);
  const r = account.reward;
  const claim = async () => {
    setBusy(true);
    try {
      onAccount((await api.claimReward(token)).account);
    } catch {
      // Already claimed elsewhere: refresh to show the real state.
      onAccount((await api.account(token)).account);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={T.dailyReward} onClose={onClose}>
      <View style={styles.days}>
        {r.cycle.map((amount, i) => (
          <View key={i} style={[styles.day, i === r.dayIndex && styles.dayNext, i < r.dayIndex && styles.dayDone]}>
            <Text style={styles.dayLabel}>{T.rewardDay(i + 1)}</Text>
            <Text style={styles.dayAmount}>🪙 {amount.toLocaleString()}</Text>
          </View>
        ))}
      </View>
      <Text style={formStyles.hint}>{T.rewardNote}</Text>
      <Btn label={r.claimable ? T.claim(r.nextAmount) : T.claimed} primary disabled={!r.claimable || busy} onPress={claim} />
    </Sheet>
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
};

function PrivateRoomSheet({ info, balance, onClose, onCreate }: { info: ServerInfo; balance: number; onClose(): void; onCreate(o: GameOptions): void }) {
  const maxBase = Math.max(0, Math.min(Math.floor(balance * info.privateRoom.maxBaseRatio), info.privateRoom.maxBase));
  const [base, setBase] = useState(String(Math.min(10, maxBase)));
  const [hands, setHands] = useState(4);
  const [rules, setRules] = useState<PrivateRules>(DEFAULT_RULES);
  const baseNum = Number(base);
  const valid = Number.isInteger(baseNum) && baseNum >= 0 && baseNum <= maxBase;
  const toggle = (key: 'huanSanZhang' | 'callTransfer') => setRules((r) => ({ ...r, [key]: !r[key] }));

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
  root: { flex: 1, backgroundColor: '#1f6b47', padding: 16, gap: 10 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 14, padding: 8 },
  avatar: { fontSize: 32 },
  nickname: { color: '#fff', fontWeight: '800', fontSize: 15 },
  coins: { color: '#ffe082', fontWeight: '700', fontVariant: ['tabular-nums'] },
  limit: { color: '#ffcc80', fontSize: 13 },
  heading: { color: '#e8f5e9', fontSize: 15, fontWeight: '700' },
  tables: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  table: { width: 150, minHeight: 96, borderRadius: 14, padding: 12, backgroundColor: '#fdfaf2', justifyContent: 'center', gap: 4 },
  privateCard: { backgroundColor: '#fff3e0' },
  disabled: { opacity: 0.45 },
  pressed: { transform: [{ scale: 0.97 }] },
  tableName: { fontSize: 18, fontWeight: '900', color: '#3e2723' },
  tableInfo: { fontSize: 12, color: '#5d4037' },
  short: { color: '#c62828' },
  days: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  day: { padding: 8, borderRadius: 10, backgroundColor: '#eceff1', alignItems: 'center', minWidth: 80 },
  dayNext: { backgroundColor: '#ffe082' },
  dayDone: { opacity: 0.5 },
  dayLabel: { fontSize: 12, color: '#455a64' },
  dayAmount: { fontWeight: '800', color: '#3e2723' },
  stepper: { fontSize: 18, fontWeight: '800', minWidth: 30, textAlign: 'center' },
});
