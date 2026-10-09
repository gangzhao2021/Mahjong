/** 好友房: open a room or join one by its 6-digit number, then wait for friends until the host starts. */
import type { FriendRoomInfo } from '@mahjong/protocol';
import { useState } from 'react';
import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Btn } from '../components/ActionBar';
import { formStyles, Sheet } from '../components/Sheet';
import { T } from '../strings';

export interface FriendActions {
  create(handsPerGame: number, xueliu: boolean): void;
  join(code: string): void;
  leave(): void;
  /** `fillWithAi: false` plays with just the friends present (两房). */
  start(fillWithAi: boolean): void;
}

/** Before joining: create a room, or type a friend's room number. */
export function FriendRoomEntrySheet({ maxHands, actions, onClose }: { maxHands: number; actions: FriendActions; onClose(): void }) {
  const [hands, setHands] = useState(4);
  const [xueliu, setXueliu] = useState(false);
  const [code, setCode] = useState('');
  const valid = /^\d{6}$/.test(code);
  return (
    <Sheet title={T.friend.title} onClose={onClose} width={460}>
      <Text style={formStyles.hint}>{T.friend.intro}</Text>
      <Text style={styles.section}>{T.friend.createTitle}</Text>
      <View style={formStyles.row}>
        <Text style={formStyles.label}>{T.hands}</Text>
        <Btn label="−" onPress={() => setHands((h) => Math.max(1, h - 1))} />
        <Text style={styles.stepper}>{hands}</Text>
        <Btn label="+" onPress={() => setHands((h) => Math.min(maxHands, h + 1))} />
        <Btn label={T.friend.create} primary onPress={() => actions.create(hands, xueliu)} />
      </View>
      <View style={formStyles.row}>
        <Switch value={xueliu} onValueChange={setXueliu} />
        <Text style={formStyles.label}>{T.rules.xueliu}</Text>
      </View>
      <Text style={styles.section}>{T.friend.joinTitle}</Text>
      <View style={formStyles.row}>
        <TextInput
          style={[formStyles.input, styles.code]}
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          placeholder="123456"
          maxLength={6}
          accessibilityLabel={T.friend.joinTitle}
        />
        <Btn label={T.friend.join} primary={valid} disabled={!valid} onPress={() => actions.join(code)} />
      </View>
    </Sheet>
  );
}

/** The waiting room: the number to share, who is in, and (for the host) the start button. */
export function WaitingRoomSheet({ room, myId, actions }: { room: FriendRoomInfo; myId: string; actions: FriendActions }) {
  const isHost = room.members.find((m) => m.playerId === myId)?.isHost ?? false;
  const seats = Array.from({ length: room.maxPlayers }, (_, i) => room.members[i] ?? null);
  return (
    <Sheet title={T.friend.waitingTitle} width={480}>
      <View style={styles.codeBox}>
        <Text style={styles.codeLabel}>{T.friend.roomNumber}</Text>
        <Text style={styles.codeBig} selectable>
          {room.code}
        </Text>
        <Text style={formStyles.hint}>{T.friend.share}</Text>
      </View>
      <View style={styles.members}>
        {seats.map((m, i) => (
          <View key={i} style={[styles.member, !m && styles.empty]}>
            <Text style={styles.avatar}>{m ? m.avatar : '🤖'}</Text>
            <Text style={styles.name} numberOfLines={1}>
              {m ? m.name : T.friend.aiFill}
            </Text>
            {m && (
              <Text style={styles.tag}>
                {m.isHost ? `👑 ${T.friend.host}` : ''}
                {m.playerId === myId ? ` ${T.me}` : ''}
                {!m.online ? ` · ${T.friend.offline}` : ''}
              </Text>
            )}
          </View>
        ))}
      </View>
      <Text style={formStyles.hint}>{T.friend.rules(room.handsPerGame, T.modeName(room.xueliu))}</Text>
      <View style={styles.buttons}>
        <Btn label={T.friend.leave} onPress={actions.leave} />
        {isHost && room.members.length < 2 ? (
          <Btn label={T.friend.needFriend} disabled onPress={() => undefined} />
        ) : isHost && room.members.length < room.maxPlayers ? (
          <>
            {/* Not a full table: fill with AI, or play just the friends present (两房) */}
            <Btn label={T.friend.startWithAi} onPress={() => actions.start(true)} />
            <Btn label={T.friend.startJustUs(room.members.length)} primary onPress={() => actions.start(false)} />
          </>
        ) : isHost ? (
          <Btn label={T.friend.start} primary onPress={() => actions.start(true)} />
        ) : (
          <Text style={styles.waiting}>{T.friend.waitingHost}</Text>
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  section: { fontWeight: '900', color: '#4e342e', marginTop: 4 },
  stepper: { fontSize: 18, fontWeight: '800', minWidth: 30, textAlign: 'center' },
  code: { width: 140, fontSize: 20, letterSpacing: 4, textAlign: 'center' },
  codeBox: { alignItems: 'center', gap: 2, backgroundColor: '#fff3e0', borderRadius: 12, paddingVertical: 8 },
  codeLabel: { color: '#6d4c41', fontSize: 12, fontWeight: '700' },
  codeBig: { fontSize: 34, fontWeight: '900', letterSpacing: 8, color: '#bf360c', fontVariant: ['tabular-nums'] },
  members: { flexDirection: 'row', gap: 8 },
  member: { flex: 1, alignItems: 'center', gap: 2, backgroundColor: '#eceff1', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 4 },
  empty: { opacity: 0.5 },
  avatar: { fontSize: 26 },
  name: { fontWeight: '800', color: '#37474f', fontSize: 13 },
  tag: { fontSize: 11, color: '#6d4c41' },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 10 },
  waiting: { color: '#6d4c41', fontWeight: '700' },
});
