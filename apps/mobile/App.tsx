import type { AccountSummary, GameOptions, ServerInfo } from '@mahjong/protocol';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Btn } from './src/components/ActionBar';
import { Felt } from './src/components/Felt';
import { Sheet } from './src/components/Sheet';
import { TileFan } from './src/components/TileFan';
import { TileGallery } from './src/components/TileGallery';
import { setMusicWanted } from './src/audio/sound';
import { api } from './src/net/api';
import { setCrashReportToken } from './src/net/crash';
import { loadToken, saveToken } from './src/net/session';
import { useGame } from './src/net/useGame';
import { AccountScreen } from './src/screens/AccountScreen';
import { ConsentScreen, loadConsent } from './src/screens/ConsentScreen';
import { GameScreen } from './src/screens/GameScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { RulesScreen } from './src/rules/RulesScreen';
import { LobbyScreen } from './src/screens/LobbyScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { RealNameScreen } from './src/screens/RealNameScreen';
import { loadTutorialProgress, TutorialScreen } from './src/tutorial/TutorialScreen';
import { changeLocale } from './src/i18n';
import { getLocale, T } from './src/strings';

/** Development only: `?tiles` on web shows every tile face. */
const SHOW_TILE_GALLERY = __DEV__ && typeof window !== 'undefined' && !!window.location?.search?.includes('tiles');

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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialDone, setTutorialDone] = useState(-1);
  const [consented, setConsented] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    void loadConsent().then(setConsented);
  }, []);
  useEffect(() => setCrashReportToken(token ?? null), [token]);
  // The China build is Chinese only.
  useEffect(() => {
    if (info?.region === 'china' && getLocale() !== 'zh') changeLocale('zh', false);
  }, [info]);
  useEffect(() => {
    if (!tutorialOpen) void loadTutorialProgress().then((d) => setTutorialDone(d.length));
  }, [tutorialOpen]);
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

  // Background music in the lobby, the game and the tutorial.
  const musicOn = tutorialOpen || (!!token && !!game.account);
  useEffect(() => setMusicWanted(musicOn), [musicOn]);

  const errorToast = useToast(game.error, game.error ? game.error.length : undefined);
  const chatToast = useToast(game.chatRejected ? T.chatRejected[game.chatRejected.reason] : null, game.chatRejected?.at, 2500);
  const startToast = useToast(game.startRejected ? T.startRejected[game.startRejected.reason] : null, game.startRejected?.at, 4000);
  const noticeToast = useToast(game.notice ? T.limitEnding : null, game.notice?.at, 6000);
  const rewardToast = useToast(
    game.rewards ? T.tasks.earned(game.rewards.items.map((r) => T.tasks.names[r.id]).join(T.listSeparator), game.rewards.items.reduce((n, r) => n + r.amount, 0)) : null,
    game.rewards?.at,
    4500,
  );

  let screen: React.ReactNode;
  if (SHOW_TILE_GALLERY) {
    screen = <TileGallery />;
  } else if (rulesOpen) {
    // Static content: readable before signing in and offline.
    screen = <RulesScreen onClose={() => setRulesOpen(false)} />;
  } else if (tutorialOpen) {
    // Runs locally: works offline and before signing in.
    screen = <TutorialScreen onExit={() => setTutorialOpen(false)} />;
  } else if (consented === false) {
    // Nothing is collected until the player agrees (PRD Appendix D.7).
    screen = <ConsentScreen onAgree={() => setConsented(true)} onOpenTutorial={() => setTutorialOpen(true)} />;
  } else if (!info || token === undefined || consented === undefined || (token && !game.account)) {
    screen = (
      <Felt style={styles.splash}>
        <TileFan width={48} />
        <Text style={styles.splashTitle}>{T.appTitle}</Text>
        <Text style={styles.splashText}>{T.connecting}</Text>
      </Felt>
    );
  } else if (!token) {
    screen = <LoginScreen info={info} onLoggedIn={onLoggedIn} onOpenTutorial={() => setTutorialOpen(true)} />;
  } else if (game.account!.realName.required && !game.account!.realName.verified) {
    screen = <RealNameScreen token={token} onVerified={setAccount} onLogout={logout} />;
  } else if (historyOpen && !game.table) {
    screen = <HistoryScreen token={token} onClose={() => setHistoryOpen(false)} />;
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
        onOpenTutorial={() => setTutorialOpen(true)}
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenRules={() => setRulesOpen(true)}
        tutorialDone={tutorialDone}
      />
    );
  }

  const toast = errorToast ?? chatToast ?? startToast ?? noticeToast ?? rewardToast ?? (game.leftReason ? T.startRejected[game.leftReason] : null);
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
          <Text style={styles.toastText}>{T.reconnecting}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1f6b47' },
  splash: { alignItems: 'center', justifyContent: 'center', gap: 12 },
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
