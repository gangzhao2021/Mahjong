/** 中文 / English switch (global build only; the China build is always Chinese). */
import { Text, View } from 'react-native';
import { changeLocale } from '../i18n';
import { getLocale, T, type Locale } from '../strings';
import { Btn } from './ActionBar';
import { formStyles } from './Sheet';

export function LanguagePicker({ label = true }: { label?: boolean }) {
  const current = getLocale();
  return (
    <View style={formStyles.row}>
      {label && <Text style={formStyles.label}>{T.language.title}</Text>}
      {(['zh', 'en'] as Locale[]).map((l) => (
        <Btn key={l} label={T.language[l]} primary={l === current} onPress={() => changeLocale(l)} />
      ))}
    </View>
  );
}
