/** 成就: milestones that unlock by playing and pay themselves, plus the login reward schedule (also automatic). */
import type { AccountSummary, AchievementsStatus } from '@mahjong/protocol';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Btn } from '../components/ActionBar';
import { Sheet } from '../components/Sheet';
import { api } from '../net/api';
import { T } from '../strings';

export function AchievementsSheet({ token, account, onAccount, onClose }: { token: string; account: AccountSummary; onAccount(a: AccountSummary): void; onClose(): void }) {
  const [status, setStatus] = useState<AchievementsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.achievements(token).then(setStatus, () => undefined);
  }, [token]);

  // Earned achievements are paid automatically; this only covers one that somehow wasn't.
  const claim = async (id: string) => {
    setBusy(true);
    try {
      const r = await api.claimAchievement(token, id);
      setStatus(r.achievements);
      onAccount(r.account);
    } catch {
      setStatus(await api.achievements(token).catch(() => status));
    } finally {
      setBusy(false);
    }
  };

  const r = account.reward;
  return (
    <Sheet title={T.achievements.title} onClose={onClose} width={560}>
      {!status ? (
        <ActivityIndicator />
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
          <Text style={styles.intro}>{T.achievements.intro}</Text>
          <Text style={styles.section}>{T.achievements.loginTitle}</Text>
          <View style={styles.days}>
            {r.cycle.map((amount, i) => (
              <View key={i} style={[styles.day, i === r.dayIndex && styles.dayNext, i < r.dayIndex && styles.dayDone]}>
                <Text style={styles.dayLabel}>{T.rewardDay(i + 1)}</Text>
                <Text style={styles.dayAmount}>🪙 {amount.toLocaleString()}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.section}>{T.achievements.listTitle}</Text>
          {status.achievements.map((a) => {
            const earned = a.unlockedAt !== null;
            return (
              <View key={a.id} style={[styles.row, !earned && styles.locked]}>
                <Text style={styles.icon}>{earned ? '🏆' : '🔒'}</Text>
                <View style={styles.text}>
                  <Text style={styles.name}>{T.achievements.names[a.id]}</Text>
                  <Text style={styles.detail}>
                    {earned ? new Date(a.unlockedAt!).toLocaleDateString() : T.achievements.locked} · 🪙 {a.reward}
                  </Text>
                </View>
                {earned && a.claimed ? (
                  <Text style={styles.paid}>✓ {T.achievements.paid}</Text>
                ) : earned ? (
                  <Btn label={T.achievements.claim(a.reward)} primary disabled={busy} onPress={() => claim(a.id)} />
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  body: { gap: 6 },
  intro: { fontSize: 12, color: '#6d4c41' },
  section: { fontWeight: '900', color: '#4e342e', marginTop: 4 },
  days: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  day: { padding: 6, borderRadius: 10, backgroundColor: '#eceff1', alignItems: 'center', minWidth: 64 },
  dayNext: { backgroundColor: '#ffe082' },
  dayDone: { opacity: 0.5 },
  dayLabel: { fontSize: 11, color: '#455a64' },
  dayAmount: { fontWeight: '800', color: '#3e2723', fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff3e0', borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10 },
  locked: { opacity: 0.55 },
  icon: { fontSize: 20 },
  text: { flex: 1 },
  name: { fontWeight: '800', color: '#3e2723' },
  detail: { fontSize: 12, color: '#6d4c41' },
  paid: { color: '#2e7d32', fontWeight: '800' },
});
