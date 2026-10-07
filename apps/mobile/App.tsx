import type { AccountSummary, GameOptions, ServerInfo } from '@mahjong/protocol';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Btn } from './src/components/ActionBar';
import { Sheet } from './src/components/Sheet';
import { api } from './src/net/api';
import { loadToken, saveToken } from './src/net/session';
import { useGame } from './src/net/useGame';
import { AccountScreen } from './src/screens/AccountScreen';
import { GameScreen } from './src/screens/GameScreen';
import { LobbyScreen } from './src/screens/LobbyScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { RealNameScreen } from './src/screens/RealNameScreen';
import { T } from './src/strings';

/** Shows the latest value of `key` for a few seconds. */
function useToast<V>(value: V | null, key: number | undefined, ms = 3000): V | null {
  const [hiddenKey, setHiddenKey] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (key === undefined) return;
    const t = setTimeout(() => setHiddenKey(key), ms);
    return () => clearTimeout(t);
  }, [key, ms]);
  return value !== null && key !== hiddenKey ? value : null;
}

export default function App() {
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [accountOpen, setAccountOpen] = useState(false);
  const lastOptions = useRef<GameOptions>({ tableId: 'practice' });

  useEffect(() => {
    let live = true;
    let retry: ReturnType<typeof setTimeout>;
    const load = () =>
      api.config().then(
        (c) => live && setInfo(c),
        () => {
          retry = setTimeout(load, 3000);
        },
      );
    void load();
    void loadToken().then((t) => live && setToken(t));
    return () => {
      live = false;
      clearTimeout(retry);
    };
  }, []);

  const logout = useCallback(() => {
    void saveToken(null);
    setAccountOpen(false);
    setToken(null);
  }, []);

  const game = useGame(token ?? null, logout);
  const { setAccount } = game;

  const onLoggedIn = useCallback(
    (t: string, account: AccountSummary) => {
      void saveToken(t);
      setAccount(account);
      setToken(t);
    },
    [setAccount],
  );

  const start = (options: GameOptions) => {
    lastOptions.current = options;
    game.startGame(options);
  };

  const errorToast = useToast(game.error, game.error ? game.error.length : undefined);
  const chatToast = useToast(game.chatRejected ? T.chatRejected[game.chatRejected.reason] : null, game.chatRejected?.at, 2500);
  const startToast = useToast(game.startRejected ? T.startRejected[game.startRejected.reason] : null, game.startRejected?.at, 4000);
  const noticeToast = useToast(game.notice ? T.limitEnding : null, game.notice?.at, 6000);

  let screen: React.ReactNode;
  if (!info || token === undefined || (token && !game.account)) {
    screen = (
      <View style={styles.splash}>
        <Text style={styles.splashTitle}>{T.appTitle}</Text>
        <Text style={styles.splashText}>{T.connecting}</Text>
      </View>
    );
  } else if (!token) {
    screen = <LoginScreen info={info} onLoggedIn={onLoggedIn} />;
  } else if (game.account!.realName.required && !game.account!.realName.verified) {
    screen = <RealNameScreen token={token} onVerified={setAccount} onLogout={logout} />;
  } else if (game.table) {
    screen = <GameScreen game={{ ...game, table: game.table }} onNewGame={() => start(lastOptions.current)} />;
  } else {
    screen = (
      <LobbyScreen
        info={info}
        token={token}
        account={game.account!}
        status={game.status}
        onAccount={setAccount}
        onStart={start}
        onOpenAccount={() => setAccountOpen(true)}
      />
    );
  }

  const toast = errorToast ?? chatToast ?? startToast ?? noticeToast ?? (game.leftReason ? T.startRejected[game.leftReason] : null);
  return (
    <View style={styles.root}>
      <StatusBar hidden />
      {screen}
      {info && token && game.account && accountOpen && !game.table && (
        <AccountScreen
          info={info}
          token={token}
          account={game.account}
          onAccount={setAccount}
          onBanter={(level) => {
            game.setBanter(level);
            setAccount({ ...game.account!, banterLevel: level });
          }}
          onLogout={logout}
          onClose={() => setAccountOpen(false)}
        />
      )}
      {game.pendingResult && !game.table && (
        <Sheet title={T.gameResult} width={400}>
          <Text>{T.awayResult}</Text>
          <Text style={styles.big}>{T.gameCoins(game.pendingResult.coinChange)}</Text>
          <Btn label={T.ok} primary onPress={game.dismissPendingResult} />
        </Sheet>
      )}
      {toast && (
        <View pointerEvents="none" style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
      {token && game.account && game.status !== 'online' && (
        <View pointerEvents="none" style={styles.toast}>
          <Text style={styles.toastText}>正在重新连接…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1f6b47' },
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  splashTitle: { fontSize: 30, fontWeight: '900', color: '#fff8e1' },
  splashText: { color: '#c8e6c9' },
  big: { fontSize: 22, fontWeight: '800', color: '#3e2723' },
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
