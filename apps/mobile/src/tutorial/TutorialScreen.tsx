/** Lesson menu and the guided lesson view (PRD §27). */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Btn } from '../components/ActionBar';
import { Felt } from '../components/Felt';
import { GameScreen } from '../screens/GameScreen';
import { T, tr } from '../strings';
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

  const next = LESSONS.find((l) => !done.includes(l.id));
  return (
    <Felt style={styles.menu}>
      <View style={styles.menuHead}>
        <View style={styles.menuTitles}>
          <Text style={styles.title}>📖 {T.tutorial.title}</Text>
          <Text style={styles.subtitle}>{T.tutorial.subtitle}</Text>
        </View>
        <Text style={styles.progress}>
          {done.length}/{LESSONS.length}
        </Text>
        <Btn label={T.tutorial.back} onPress={onExit} />
      </View>
      <View style={styles.cards}>
        {LESSONS.map((l, i) => {
          const finished = done.includes(l.id);
          const isNext = l === next;
          const [, number, name] = tr(l.title).match(/^(\d+)\.\s*(.*)$/) ?? [null, String(i + 1), tr(l.title)];
          return (
            <Pressable
              key={l.id}
              style={({ pressed }) => [styles.card, isNext && styles.cardNext, pressed && styles.pressed]}
              onPress={() => setLesson(l)}
              accessibilityRole="button"
              accessibilityLabel={tr(l.title)}
            >
              <View style={[styles.number, finished && styles.numberDone, isNext && styles.numberNext]}>
                <Text style={[styles.numberText, (finished || isNext) && styles.numberTextOn]}>{finished ? '✓' : number}</Text>
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{name}</Text>
                <Text style={styles.cardText}>{tr(l.summary)}</Text>
                {isNext && <Text style={styles.cardNextLabel}>▶ {T.continueLesson}</Text>}
              </View>
            </Pressable>
          );
        })}
      </View>
    </Felt>
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
            {tr(lesson.title)} · {Math.min(t.stepIndex + 1, lesson.steps.length)}/{lesson.steps.length}
          </Text>
          {t.done ? <Text style={styles.coachText}>{T.tutorial.lessonDone}</Text> : <Text style={styles.coachText}>{tr(step.text)}</Text>}
          {/* The card can cover a speech bubble, so the lines are repeated here. */}
          {!t.done &&
            step.say?.map((line, i) => (
              <Text key={i} style={styles.coachSay}>
                {t.game.table.seats[line.seat].avatar} {t.game.table.seats[line.seat].name}{T.colon}“{tr(line.text)}”
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
  menu: { padding: 16, gap: 12 },
  menuHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  menuTitles: { flex: 1, gap: 2 },
  title: { color: '#fff8e1', fontSize: 22, fontWeight: '900' },
  subtitle: { color: '#c8e6c9', fontSize: 13 },
  progress: { color: '#ffd54f', fontSize: 20, fontWeight: '900', fontVariant: ['tabular-nums'] },
  cards: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignContent: 'stretch' },
  card: {
    flexGrow: 1,
    flexBasis: '30%',
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#fdfaf2',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  cardNext: { borderWidth: 3, borderColor: '#ffca28' },
  pressed: { transform: [{ scale: 0.97 }] },
  number: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#e8e0cc', alignItems: 'center', justifyContent: 'center' },
  numberDone: { backgroundColor: '#43a047' },
  numberNext: { backgroundColor: '#ffca28' },
  numberText: { fontSize: 18, fontWeight: '900', color: '#6d4c41' },
  numberTextOn: { color: '#fff' },
  cardBody: { flex: 1, gap: 2 },
  cardTitle: { fontWeight: '900', color: '#3e2723', fontSize: 15 },
  cardText: { color: '#5d4037', fontSize: 12 },
  cardNextLabel: { color: '#b28704', fontSize: 12, fontWeight: '800' },
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
