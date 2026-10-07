/** Lesson menu and the guided lesson view (PRD §27). */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Btn } from '../components/ActionBar';
import { GameScreen } from '../screens/GameScreen';
import { T } from '../strings';
import { LESSONS, type Lesson } from './lessons';
import { useTutorial } from './useTutorial';

const PROGRESS_KEY = 'mahjong.tutorialDone';

export async function loadTutorialProgress(): Promise<string[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(PROGRESS_KEY)) ?? '[]') as string[];
  } catch {
    return [];
  }
}

async function markDone(id: string): Promise<string[]> {
  const done = [...new Set([...(await loadTutorialProgress()), id])];
  try {
    await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(done));
  } catch {
    // Progress just isn't remembered.
  }
  return done;
}

export function TutorialScreen({ onExit }: { onExit(): void }) {
  const [done, setDone] = useState<string[]>([]);
  const [lesson, setLesson] = useState<Lesson | null>(null);

  useEffect(() => {
    void loadTutorialProgress().then(setDone);
  }, []);

  if (lesson) {
    const index = LESSONS.indexOf(lesson);
    return (
      <LessonView
        key={lesson.id}
        lesson={lesson}
        onExit={() => setLesson(null)}
        onFinish={async () => {
          setDone(await markDone(lesson.id));
          setLesson(LESSONS[index + 1] ?? null);
        }}
      />
    );
  }

  return (
    <View style={styles.menu}>
      <View style={styles.menuHead}>
        <Text style={styles.title}>{T.tutorial.title}</Text>
        <Btn label={T.tutorial.back} onPress={onExit} />
      </View>
      <Text style={styles.subtitle}>{T.tutorial.subtitle}</Text>
      <View style={styles.cards}>
        {LESSONS.map((l) => (
          <Pressable key={l.id} style={({ pressed }) => [styles.card, pressed && styles.pressed]} onPress={() => setLesson(l)} accessibilityRole="button">
            <Text style={styles.cardTitle}>
              {l.title} {done.includes(l.id) ? '✓' : ''}
            </Text>
            <Text style={styles.cardText}>{l.summary}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function LessonView({ lesson, onExit, onFinish }: { lesson: Lesson; onExit(): void; onFinish(): void }) {
  const t = useTutorial(lesson, onExit);
  const step = lesson.steps[t.stepIndex];
  return (
    <View style={styles.fill}>
      <GameScreen game={t.game} onNewGame={() => undefined} />
      <View style={styles.coach} pointerEvents="box-none">
        <View style={styles.coachCard}>
          <Text style={styles.coachStep}>
            {lesson.title} · {Math.min(t.stepIndex + 1, lesson.steps.length)}/{lesson.steps.length}
          </Text>
          {t.done ? <Text style={styles.coachText}>{T.tutorial.lessonDone}</Text> : <Text style={styles.coachText}>{step.text}</Text>}
          {/* The card can cover a speech bubble, so the lines are repeated here. */}
          {!t.done &&
            step.say?.map((line, i) => (
              <Text key={i} style={styles.coachSay}>
                {t.game.table.seats[line.seat].avatar} {t.game.table.seats[line.seat].name}：「{line.text}」
              </Text>
            ))}
          {t.hint && <Text style={styles.coachHint}>{t.hint}</Text>}
          <View style={styles.coachButtons}>
            {t.done ? (
              <Btn label={T.tutorial.continue} primary onPress={onFinish} />
            ) : !step.expect ? (
              <Btn label={T.tutorial.next} primary disabled={t.busy} onPress={t.next} />
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  menu: { flex: 1, backgroundColor: '#1f6b47', padding: 16, gap: 10 },
  menuHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: '#fff8e1', fontSize: 22, fontWeight: '900' },
  subtitle: { color: '#c8e6c9' },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: { width: 180, padding: 12, borderRadius: 12, backgroundColor: '#fdfaf2', gap: 4 },
  pressed: { transform: [{ scale: 0.97 }] },
  cardTitle: { fontWeight: '800', color: '#3e2723' },
  cardText: { color: '#5d4037', fontSize: 12 },
  coach: { position: 'absolute', top: 48, left: 0, right: 0, alignItems: 'center' },
  coachCard: {
    maxWidth: 460,
    marginHorizontal: 12,
    backgroundColor: 'rgba(253,250,242,0.97)',
    borderRadius: 14,
    padding: 12,
    gap: 6,
    borderWidth: 2,
    borderColor: '#ffd54f',
  },
  coachStep: { color: '#8d6e63', fontSize: 11, fontWeight: '700' },
  coachText: { color: '#3e2723', fontSize: 14, lineHeight: 20 },
  coachHint: { color: '#c62828', fontSize: 13 },
  coachSay: { color: '#6d4c41', fontSize: 13, fontStyle: 'italic' },
  coachButtons: { flexDirection: 'row', justifyContent: 'flex-end' },
});
