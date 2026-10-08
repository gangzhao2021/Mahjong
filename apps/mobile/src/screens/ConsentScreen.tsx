/**
 * First-launch privacy consent (PRD Appendix C, D.7): shown before login,
 * before any device identifier is generated or personal data is sent.
 * Declining keeps the offline tutorial available.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Btn } from '../components/ActionBar';
import { Felt } from '../components/Felt';
import { formStyles } from '../components/Sheet';
import { SERVER_HTTP } from '../config';
import { getLocale, T } from '../strings';

const KEY = 'mahjong.consent';
/** Bump when the policy changes materially, so players are asked again. */
export const CONSENT_VERSION = '2026-10-07';

export async function loadConsent(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === CONSENT_VERSION;
  } catch {
    return false;
  }
}

export const openLegal = (page: 'privacy' | 'terms' | 'sdks') => void Linking.openURL(`${SERVER_HTTP}/legal/${page}?lang=${getLocale()}`).catch(() => undefined);

export function LegalLinks() {
  return (
    <View style={formStyles.row}>
      <Text style={styles.link} accessibilityRole="link" onPress={() => openLegal('terms')}>
        {T.legal.terms}
      </Text>
      <Text style={styles.link} accessibilityRole="link" onPress={() => openLegal('privacy')}>
        {T.legal.privacy}
      </Text>
      <Text style={styles.link} accessibilityRole="link" onPress={() => openLegal('sdks')}>
        {T.legal.sdks}
      </Text>
    </View>
  );
}

export function ConsentScreen({ onAgree, onOpenTutorial }: { onAgree(): void; onOpenTutorial(): void }) {
  const [declined, setDeclined] = useState(false);
  const agree = async () => {
    try {
      await AsyncStorage.setItem(KEY, CONSENT_VERSION);
    } catch {
      // Asked again next launch.
    }
    onAgree();
  };
  return (
    <Felt style={styles.root}>
      <View style={styles.box}>
        <Text style={styles.title}>{T.consent.title}</Text>
        <Text style={styles.body}>{declined ? T.consent.declined : T.consent.body}</Text>
        <LegalLinks />
        <View style={formStyles.row}>
          {declined ? (
            <>
              <Btn label={`📖 ${T.tutorial.title}`} onPress={onOpenTutorial} />
              <Btn label={T.consent.reread} primary onPress={() => setDeclined(false)} />
            </>
          ) : (
            <>
              <Btn label={T.consent.decline} onPress={() => setDeclined(true)} />
              <Btn label={T.consent.agree} primary onPress={agree} />
            </>
          )}
        </View>
      </View>
    </Felt>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center', padding: 16 },
  box: { backgroundColor: 'rgba(253,250,242,0.97)', borderRadius: 16, padding: 20, gap: 14, alignItems: 'center', maxWidth: 560 },
  title: { fontSize: 22, fontWeight: '800', color: '#3e2723' },
  body: { color: '#37474f', lineHeight: 22 },
  link: { color: '#1565c0', textDecorationLine: 'underline' },
});
