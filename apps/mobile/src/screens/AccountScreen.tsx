/** Profile, banter setting, account linking, coin history, logout and deletion (PRD §19–§20). */
import type { AccountSummary, BanterLevel, LoginMethod, ServerInfo } from '@mahjong/protocol';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Btn } from '../components/ActionBar';
import { AboutSheet } from './AboutSheet';
import { updateSoundSettings, useSoundSettings } from '../audio/sound';
import { BanterPicker } from '../components/Chat';
import { formStyles, Sheet } from '../components/Sheet';
import { api, ApiError, type LedgerEntry } from '../net/api';
import { T } from '../strings';
import { credentialsFor, errorText, PhoneLogin } from './LoginScreen';

interface Props {
  info: ServerInfo;
  token: string;
  account: AccountSummary;
  onAccount(account: AccountSummary): void;
  onBanter(level: BanterLevel): void;
  onLogout(): void;
  onClose(): void;
}

export function AccountScreen({ info, token, account, onAccount, onBanter, onLogout, onClose }: Props) {
  const [nickname, setNickname] = useState(account.nickname);
  const [message, setMessage] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [linkingPhone, setLinkingPhone] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let live = true;
    api.ledger(token).then((r) => live && setLedger(r.entries)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [token, account.balance]);

  const patch = async (p: Parameters<typeof api.updateProfile>[1]) => {
    setMessage(null);
    try {
      onAccount((await api.updateProfile(token, p)).account);
    } catch (e) {
      setMessage(e instanceof ApiError && e.code === 'nicknameRejected' ? '昵称不可用' : errorText(e));
    }
  };

  const link = async (method: LoginMethod, credentials: Record<string, unknown> | null) => {
    if (!credentials) return;
    setMessage(null);
    try {
      onAccount((await api.link(token, method, credentials)).account);
      setLinkingPhone(false);
    } catch (e) {
      setMessage(e instanceof ApiError && e.code === 'identityInUse' ? T.linkConflict : errorText(e));
    }
  };

  const sound = useSoundSettings();
  const [aboutOpen, setAboutOpen] = useState(false);
  if (aboutOpen) return <AboutSheet china={info.region === 'china'} onClose={() => setAboutOpen(false)} />;
  const linkable = info.loginMethods.filter((m): m is Exclude<LoginMethod, 'guest'> => m !== 'guest' && !account.providers.includes(m));

  if (confirmDelete) {
    return (
      <Sheet title={T.deleteConfirmTitle} onClose={() => setConfirmDelete(false)} width={400}>
        <Text style={formStyles.label}>{T.deleteConfirmBody}</Text>
        <View style={formStyles.row}>
          <Btn label={T.cancel} onPress={() => setConfirmDelete(false)} />
          <Btn
            label={T.deleteAccount}
            danger
            onPress={async () => {
              await api.deleteAccount(token).catch(() => undefined);
              onLogout();
            }}
          />
        </View>
      </Sheet>
    );
  }

  return (
    <Sheet title={T.account} onClose={onClose} width={620}>
      <View style={formStyles.row}>
        <Text style={formStyles.label}>{T.nickname}</Text>
        <TextInput style={formStyles.input} value={nickname} onChangeText={setNickname} maxLength={12} />
        <Btn label={T.save} disabled={nickname.trim() === account.nickname} onPress={() => patch({ nickname: nickname.trim() })} />
      </View>
      <View style={formStyles.row}>
        <Text style={formStyles.label}>{T.avatar}</Text>
        {info.avatars.map((a) => (
          <Pressable key={a} onPress={() => patch({ avatar: a })} style={[styles.avatar, a === account.avatar && styles.avatarOn]}>
            <Text style={styles.avatarText}>{a}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.banter}>
        <BanterPicker level={account.banterLevel} onChange={onBanter} />
      </View>
      <View style={formStyles.row}>
        <Text style={formStyles.label}>{T.sound.title}</Text>
        <Btn label={`${T.sound.effects}：${sound.effects ? T.sound.on : T.sound.off}`} primary={sound.effects} onPress={() => updateSoundSettings({ effects: !sound.effects })} />
        <Btn label={`${T.sound.music}：${sound.music ? T.sound.on : T.sound.off}`} primary={sound.music} onPress={() => updateSoundSettings({ music: !sound.music })} />
      </View>

      <View style={formStyles.row}>
        <Text style={formStyles.label}>{T.linked}</Text>
        {account.providers.map((p) => (
          <Text key={p} style={styles.chip}>
            {T.methodNames[p]}
          </Text>
        ))}
      </View>
      {account.isGuest && <Text style={formStyles.hint}>{T.linkHint}</Text>}
      {linkable.length > 0 && (
        <View style={formStyles.row}>
          {linkable.map((m) => (
            <Btn
              key={m}
              label={`${T.link} ${T.methodNames[m]}`}
              onPress={() =>
                m === 'phone' ? setLinkingPhone(true) : credentialsFor(m).then((c) => link(m, c), (e) => setMessage(errorText(e)))
              }
            />
          ))}
        </View>
      )}
      {linkingPhone && <PhoneLogin busy={false} onSubmit={(phone, code) => link('phone', { phone, code })} onError={setMessage} />}
      {message && <Text style={formStyles.error}>{message}</Text>}

      <Text style={formStyles.label}>{T.history}</Text>
      <View style={styles.ledger}>
        {(ledger ?? []).slice(0, 20).map((e) => (
          <View key={e.id} style={styles.ledgerRow}>
            <Text style={styles.ledgerType}>{T.ledgerTypes[e.type] ?? e.type}</Text>
            <Text style={[styles.ledgerAmount, e.amount >= 0 ? styles.plus : styles.minus]}>
              {e.amount >= 0 ? '+' : ''}
              {e.amount.toLocaleString()}
            </Text>
            <Text style={styles.ledgerBalance}>{e.balanceAfter.toLocaleString()}</Text>
            <Text style={styles.ledgerTime}>{new Date(e.createdAt).toLocaleString()}</Text>
          </View>
        ))}
      </View>

      <View style={formStyles.row}>
        <Btn label={T.about.title} onPress={() => setAboutOpen(true)} />
        <Btn label={T.logout} onPress={onLogout} />
        <Btn label={T.deleteAccount} danger onPress={() => setConfirmDelete(true)} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  avatar: { padding: 4, borderRadius: 10 },
  avatarOn: { backgroundColor: '#ffe082' },
  avatarText: { fontSize: 24 },
  banter: { backgroundColor: '#1f6b47', borderRadius: 12, padding: 8 },
  chip: { backgroundColor: '#e0f2f1', color: '#004d40', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  ledger: { gap: 2 },
  ledgerRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  ledgerType: { width: 80, color: '#37474f' },
  ledgerAmount: { width: 80, textAlign: 'right', fontWeight: '700', fontVariant: ['tabular-nums'] },
  ledgerBalance: { width: 80, textAlign: 'right', color: '#78909c', fontVariant: ['tabular-nums'] },
  ledgerTime: { color: '#90a4ae', fontSize: 11 },
  plus: { color: '#2e7d32' },
  minus: { color: '#c62828' },
});
