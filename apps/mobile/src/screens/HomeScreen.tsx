import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { BanterLevel } from '@mahjong/protocol';
import { Btn } from '../components/ActionBar';
import { BanterPicker } from '../components/Chat';
import type { ConnectionStatus } from '../net/useGame';
import { T } from '../strings';

const HAND_OPTIONS = [1, 4, 8];

interface Props {
  status: ConnectionStatus;
  banterLevel: BanterLevel;
  onBanter(level: BanterLevel): void;
  onStart(handsPerGame: number): void;
}

export function HomeScreen({ status, banterLevel, onBanter, onStart }: Props) {
  const [hands, setHands] = useState(4);
  const online = status === 'online';
  return (
    <View style={styles.root}>
      <Text style={styles.title}>{T.appTitle}</Text>
      <View style={styles.options}>
        <Text style={styles.label}>{T.hands}</Text>
        {HAND_OPTIONS.map((n) => (
          <Btn key={n} label={`${n}`} primary={hands === n} onPress={() => setHands(n)} />
        ))}
      </View>
      {online && <BanterPicker level={banterLevel} onChange={onBanter} />}
      <Btn label={T.start} big primary disabled={!online} onPress={() => onStart(hands)} />
      {!online && <Text style={styles.status}>{status === 'connecting' ? T.connecting : T.offline}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1f6b47', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 16 },
  title: { fontSize: 32, fontWeight: '900', color: '#fff8e1' },
  options: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { color: '#e8f5e9', fontSize: 15, marginRight: 4 },
  status: { color: '#ffcc80' },
});
