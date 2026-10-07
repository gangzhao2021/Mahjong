import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useGame } from './src/net/useGame';
import { GameScreen } from './src/screens/GameScreen';
import { HomeScreen } from './src/screens/HomeScreen';

export default function App() {
  const game = useGame();
  const lastHands = useRef(4);

  const { error, clearError } = game;
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(clearError, 3000);
    return () => clearTimeout(timer);
  }, [error, clearError]);

  const start = (handsPerGame: number) => {
    lastHands.current = handsPerGame;
    game.startGame({ handsPerGame });
  };

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      {game.table ? (
        <GameScreen game={{ ...game, table: game.table }} onNewGame={() => start(lastHands.current)} />
      ) : (
        <HomeScreen status={game.status} onStart={start} />
      )}
      {game.error && (
        <View pointerEvents="none" style={styles.toast}>
          <Text style={styles.toastText}>{game.error}</Text>
        </View>
      )}
      {game.table && game.status !== 'online' && (
        <View pointerEvents="none" style={styles.toast}>
          <Text style={styles.toastText}>正在重新连接…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1f6b47' },
  toast: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    maxWidth: '80%',
  },
  toastText: { color: '#fff' },
});
