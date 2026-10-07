/** Login methods by region (PRD §19): guest / Apple / Google, or phone / WeChat / Apple in China. */
import type { AccountSummary, LoginMethod, ServerInfo } from '@mahjong/protocol';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { appleAvailable, signInWithApple, signInWithGoogle, signInWithWechat, SignInUnavailable } from '../auth/social';
import { Btn } from '../components/ActionBar';
import { formStyles } from '../components/Sheet';
import { api, ApiError } from '../net/api';
import { getDeviceId } from '../net/deviceId';
import { T } from '../strings';

export function errorText(e: unknown): string {
  if (e instanceof SignInUnavailable) return T.login.unavailable;
  if (e instanceof ApiError) return T.loginErrors[e.code] ?? T.loginErrors.serverError;
  return T.loginErrors.serverError;
}

/** Collects credentials for one method; shared by login and account linking. */
export async function credentialsFor(method: Exclude<LoginMethod, 'guest' | 'phone'>): Promise<Record<string, unknown> | null> {
  switch (method) {
    case 'apple':
      return signInWithApple();
    case 'google':
      return signInWithGoogle();
    case 'wechat':
      return signInWithWechat();
  }
}

interface Props {
  info: ServerInfo;
  onLoggedIn(token: string, account: AccountSummary): void;
}

export function LoginScreen({ info, onLoggedIn }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasApple, setHasApple] = useState(false);

  useEffect(() => {
    void appleAvailable().then(setHasApple);
  }, []);

  const run = async (method: LoginMethod, getCredentials: () => Promise<Record<string, unknown> | null>) => {
    setBusy(true);
    setError(null);
    try {
      const credentials = await getCredentials();
      if (!credentials) return;
      const session = await api.login(method, credentials);
      onLoggedIn(session.token, session.account);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const methods = info.loginMethods;
  return (
    <View style={styles.root}>
      <Text style={styles.title}>{T.appTitle}</Text>
      <View style={styles.box}>
        {methods.includes('phone') && <PhoneLogin busy={busy} onSubmit={(phone, code) => run('phone', async () => ({ phone, code }))} onError={setError} />}
        <View style={formStyles.row}>
          {methods.includes('wechat') && <Btn label={T.login.wechat} primary disabled={busy} onPress={() => run('wechat', () => credentialsFor('wechat'))} />}
          {methods.includes('apple') && hasApple && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={20}
              style={styles.appleButton}
              onPress={() => run('apple', () => credentialsFor('apple'))}
            />
          )}
          {methods.includes('google') && <Btn label={T.login.google} disabled={busy} onPress={() => run('google', () => credentialsFor('google'))} />}
          {methods.includes('guest') && (
            <Btn
              label={info.region === 'china' ? T.login.guestTrial : T.login.guest}
              primary={info.region !== 'china'}
              disabled={busy}
              onPress={() => run('guest', async () => ({ deviceId: await getDeviceId() }))}
            />
          )}
        </View>
        {error && <Text style={formStyles.error}>{error}</Text>}
        <Text style={formStyles.hint}>{T.login.privacy}</Text>
      </View>
    </View>
  );
}

export function PhoneLogin({ busy, onSubmit, onError }: { busy: boolean; onSubmit(phone: string, code: string): void; onError(message: string | null): void }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = async () => {
    onError(null);
    try {
      await api.sendSmsCode(phone);
      setCooldown(60);
    } catch (e) {
      onError(errorText(e));
    }
  };

  return (
    <View style={styles.phone}>
      <View style={formStyles.row}>
        <TextInput style={formStyles.input} value={phone} onChangeText={setPhone} placeholder={T.login.phonePlaceholder} keyboardType="phone-pad" maxLength={14} />
        <Btn label={cooldown > 0 ? T.login.resend(cooldown) : T.login.sendCode} disabled={cooldown > 0 || phone.length < 11} onPress={send} />
      </View>
      <View style={formStyles.row}>
        <TextInput style={formStyles.input} value={code} onChangeText={setCode} placeholder={T.login.codePlaceholder} keyboardType="number-pad" maxLength={6} />
        <Btn label={T.login.submit} primary disabled={busy || code.length !== 6} onPress={() => onSubmit(phone, code)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1f6b47', alignItems: 'center', justifyContent: 'center', padding: 16, gap: 16 },
  title: { fontSize: 30, fontWeight: '900', color: '#fff8e1' },
  box: { backgroundColor: 'rgba(253,250,242,0.96)', borderRadius: 16, padding: 16, gap: 12, alignItems: 'center', maxWidth: 560 },
  phone: { gap: 8 },
  appleButton: { width: 200, height: 40 },
});
