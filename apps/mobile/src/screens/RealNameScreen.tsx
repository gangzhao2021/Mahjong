/** Real-name verification (China build, Appendix D.2). */
import type { AccountSummary } from '@mahjong/protocol';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Btn } from '../components/ActionBar';
import { formStyles } from '../components/Sheet';
import { api, ApiError } from '../net/api';
import { T } from '../strings';

export function RealNameScreen({ token, onVerified, onLogout }: { token: string; onVerified(account: AccountSummary): void; onLogout(): void }) {
  const [name, setName] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onVerified((await api.realName(token, name, idNumber)).account);
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'invalidIdNumber' ? T.realName.invalid : T.realName.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.box}>
        <Text style={styles.title}>{T.realName.title}</Text>
        <Text style={formStyles.hint}>{T.realName.hint}</Text>
        <TextInput style={formStyles.input} value={name} onChangeText={setName} placeholder={T.realName.name} maxLength={20} />
        <TextInput style={formStyles.input} value={idNumber} onChangeText={setIdNumber} placeholder={T.realName.idNumber} maxLength={18} autoCapitalize="characters" />
        {error && <Text style={formStyles.error}>{error}</Text>}
        <View style={formStyles.row}>
          <Btn label={T.logout} onPress={onLogout} />
          <Btn label={T.realName.submit} primary disabled={busy || name.trim().length < 2 || idNumber.length !== 18} onPress={submit} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1f6b47', alignItems: 'center', justifyContent: 'center', padding: 16 },
  box: { backgroundColor: '#fdfaf2', borderRadius: 16, padding: 18, gap: 10, width: '100%', maxWidth: 420 },
  title: { fontSize: 18, fontWeight: '800', color: '#3e2723' },
});
