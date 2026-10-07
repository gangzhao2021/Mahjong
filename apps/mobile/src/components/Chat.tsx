/** Speech bubbles at the seats, the chat panel, and the banter setting (PRD §6, §7, §18). */
import type { Seat } from '@mahjong/engine';
import type { BanterLevel, ChatCatalog, ChatEntry, SeatInfo, StickerId } from '@mahjong/protocol';
import { useEffect, useRef, useState } from 'react';
import type { LocalChatEntry } from '../net/useGame';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';
import { T } from '../strings';
import { Btn } from './ActionBar';

const BUBBLE_MS = 4500;

export function stickerEmoji(catalog: ChatCatalog | null, id: StickerId | null): string {
  if (!id) return '';
  return catalog?.stickers.find((s) => s.id === id)?.emoji ?? '';
}

/** Latest line per seat, shown for a few seconds next to that seat. */
export function SpeechBubbles({
  chat,
  catalog,
  positionOf,
}: {
  chat: LocalChatEntry[];
  catalog: ChatCatalog | null;
  positionOf(seat: Seat): ViewStyle;
}) {
  const [now, setNow] = useState(() => Date.now());
  const latest = new Map<Seat, LocalChatEntry>();
  for (const e of chat) latest.set(e.seat, e);
  const visible = [...latest.values()].filter((e) => e.localAt + BUBBLE_MS > now);
  const nextExpiry = visible.length ? Math.min(...visible.map((e) => e.localAt + BUBBLE_MS)) : null;

  useEffect(() => {
    if (nextExpiry === null) return;
    const t = setTimeout(() => setNow(Date.now()), Math.max(0, nextExpiry - Date.now()) + 30);
    return () => clearTimeout(t);
  }, [nextExpiry]);

  return (
    <>
      {visible.map((e) => (
        <View key={e.id} pointerEvents="none" style={[styles.bubble, positionOf(e.seat)]}>
          {e.text ? <Text style={styles.bubbleText}>{e.text}</Text> : null}
          {e.sticker ? <Text style={styles.bubbleSticker}>{stickerEmoji(catalog, e.sticker)}</Text> : null}
        </View>
      ))}
    </>
  );
}

interface PanelProps {
  chat: ChatEntry[];
  catalog: ChatCatalog | null;
  seats: SeatInfo[];
  mySeat: Seat;
  onSend(text: string, target: Seat | 'table'): void;
  onQuickPhrase(id: string): void;
  onSticker(id: StickerId): void;
  onClose(): void;
}

export function ChatPanel({ chat, catalog, seats, mySeat, onSend, onQuickPhrase, onSticker, onClose }: PanelProps) {
  const [text, setText] = useState('');
  const [target, setTarget] = useState<Seat | 'table'>('table');
  const list = useRef<FlatList<ChatEntry>>(null);
  const nameOf = (seat: Seat) => seats[seat]?.name ?? '';

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed, target);
    setText('');
  };

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <Text style={styles.panelTitle}>{T.chat}</Text>
        <Btn label={T.close} onPress={onClose} />
      </View>
      <FlatList
        ref={list}
        style={styles.log}
        data={chat}
        keyExtractor={(e) => String(e.id)}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => (
          <Text style={[styles.logLine, item.seat === mySeat && styles.mine]}>
            <Text style={styles.logName}>{nameOf(item.seat)}</Text>
            {item.target !== 'table' ? ` → ${nameOf(item.target)}` : ''}：{item.text ?? ''} {stickerEmoji(catalog, item.sticker)}
          </Text>
        )}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip} contentContainerStyle={styles.chips}>
        {catalog?.stickers.map((s) => (
          <Pressable key={s.id} onPress={() => onSticker(s.id)} accessibilityLabel={s.label} style={styles.sticker}>
            <Text style={styles.stickerText}>{s.emoji}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip} contentContainerStyle={styles.chips}>
        {catalog?.quickPhrases.map((q) => (
          <Pressable key={q.id} onPress={() => onQuickPhrase(q.id)} style={styles.chip}>
            <Text style={styles.chipText}>{q.text}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip} contentContainerStyle={styles.chips}>
        {(['table', ...seats.filter((s) => !s.isHuman).map((s) => s.seat)] as (Seat | 'table')[]).map((t) => (
          <Pressable key={String(t)} onPress={() => setTarget(t)} style={[styles.chip, target === t && styles.chipOn]}>
            <Text style={styles.chipText}>{t === 'table' ? T.toTable : `@${nameOf(t)}`}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder={T.chatPlaceholder}
          maxLength={60}
          onSubmitEditing={send}
          returnKeyType="send"
        />
        <Btn label={T.send} primary disabled={!text.trim()} onPress={send} />
      </View>
    </View>
  );
}

export function BanterPicker({ level, onChange }: { level: BanterLevel; onChange(level: BanterLevel): void }) {
  return (
    <View style={styles.banter}>
      <Text style={styles.banterLabel}>{T.banter}</Text>
      <View style={styles.banterRow}>
        {(['mild', 'spicy', 'quiet'] as BanterLevel[]).map((l) => (
          <Btn key={l} label={T.banterLevels[l]} primary={level === l} onPress={() => onChange(l)} />
        ))}
      </View>
      <Text style={styles.banterHint}>{T.banterHint[level]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    position: 'absolute',
    maxWidth: 220,
    backgroundColor: '#fffdf5',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#e0d6b8',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  bubbleText: { color: '#3e2723', fontSize: 13, flexShrink: 1 },
  bubbleSticker: { fontSize: 26 },
  panel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: 340,
    maxWidth: '75%',
    backgroundColor: 'rgba(253,250,242,0.98)',
    padding: 10,
    gap: 6,
  },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  panelTitle: { fontSize: 16, fontWeight: '800', color: '#3e2723' },
  log: { flex: 1, minHeight: 80 },
  logLine: { color: '#37474f', fontSize: 13, paddingVertical: 2 },
  mine: { color: '#1b5e20' },
  logName: { fontWeight: '700' },
  // One horizontally scrolling row each, so the log keeps most of the height on phones.
  strip: { flexGrow: 0 },
  chips: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  chip: { backgroundColor: '#eceff1', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 },
  chipOn: { backgroundColor: '#ffd54f' },
  chipText: { fontSize: 12, color: '#263238' },
  sticker: { padding: 2 },
  stickerText: { fontSize: 22 },
  inputRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  input: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#cfd8dc',
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  banter: { alignItems: 'center', gap: 6 },
  banterLabel: { color: '#e8f5e9', fontSize: 14 },
  banterRow: { flexDirection: 'row', gap: 8 },
  banterHint: { color: '#c8e6c9', fontSize: 12 },
});
