/** 任务与成就: today's tasks and one-time achievements, each with a claim button once earned. */
import type { AccountSummary, TasksStatus } from '@mahjong/protocol';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Btn } from '../components/ActionBar';
import { Sheet } from '../components/Sheet';
import { api } from '../net/api';
import { T } from '../strings';

/** How many rewards are ready to claim (refetched whenever the sheet closes). */
export function useClaimableTasks(token: string, sheetOpen: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (sheetOpen) return;
    let live = true;
    api.tasks(token).then(
      (t) => live && setCount(claimableCount(t)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [token, sheetOpen]);
  return count;
}

function claimableCount(t: TasksStatus): number {
  return t.daily.filter((d) => !d.claimed && d.progress >= d.target).length + t.achievements.filter((a) => a.unlockedAt !== null && !a.claimed).length;
}

export function TasksSheet({ token, onAccount, onClose }: { token: string; onAccount(a: AccountSummary): void; onClose(): void }) {
  const [tasks, setTasks] = useState<TasksStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.tasks(token).then(setTasks, () => undefined);
  }, [token]);

  const claim = async (kind: 'daily' | 'achievement', id: string) => {
    setBusy(true);
    try {
      const r = await api.claimTask(token, kind, id);
      setTasks(r.tasks);
      onAccount(r.account);
    } catch {
      // Already claimed elsewhere: show the real state.
      setTasks(await api.tasks(token).catch(() => tasks));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={T.tasks.title} onClose={onClose} width={560}>
      {!tasks ? (
        <ActivityIndicator />
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
          <Text style={styles.section}>{T.tasks.daily}</Text>
          {tasks.daily.map((d) => {
            const done = d.progress >= d.target;
            return (
              <Row key={d.id} name={T.tasks.names[d.id]} detail={T.tasks.progress(d.progress, d.target)} reward={d.reward} done={done} claimed={d.claimed} busy={busy} onClaim={() => claim('daily', d.id)} />
            );
          })}
          <Text style={styles.section}>{T.tasks.achievements}</Text>
          {tasks.achievements.map((a) => (
            <Row
              key={a.id}
              name={T.tasks.names[a.id]}
              detail={a.unlockedAt ? new Date(a.unlockedAt).toLocaleDateString() : T.tasks.locked}
              reward={a.reward}
              done={a.unlockedAt !== null}
              claimed={a.claimed}
              busy={busy}
              onClaim={() => claim('achievement', a.id)}
            />
          ))}
        </ScrollView>
      )}
    </Sheet>
  );
}

function Row({ name, detail, reward, done, claimed, busy, onClaim }: { name: string; detail: string; reward: number; done: boolean; claimed: boolean; busy: boolean; onClaim(): void }) {
  return (
    <View style={[styles.row, !done && styles.locked]}>
      <View style={styles.text}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.detail}>
          {detail} · 🪙 {reward}
        </Text>
      </View>
      {claimed ? <Text style={styles.claimed}>✓ {T.tasks.claimed}</Text> : done ? <Btn label={T.tasks.claim(reward)} primary disabled={busy} onPress={onClaim} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  body: { gap: 6 },
  section: { fontWeight: '900', color: '#4e342e', marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff3e0', borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10 },
  locked: { opacity: 0.55 },
  text: { flex: 1 },
  name: { fontWeight: '800', color: '#3e2723' },
  detail: { fontSize: 12, color: '#6d4c41' },
  claimed: { color: '#2e7d32', fontWeight: '800' },
});
