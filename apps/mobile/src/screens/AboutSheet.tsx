/** About (PRD Appendix D.7): version, AI disclosure, legal links and China filing numbers. */
import Constants from 'expo-constants';
import { Text } from 'react-native';
import { Sheet, formStyles } from '../components/Sheet';
import { APP_FILING_NUMBER, ICP_NUMBER } from '../config';
import { T } from '../strings';
import { LegalLinks } from './ConsentScreen';

export function AboutSheet({ china, onClose }: { china: boolean; onClose(): void }) {
  return (
    <Sheet title={T.about.title} onClose={onClose} width={480}>
      <Text style={formStyles.label}>
        {T.appTitle} · {T.about.version(Constants.expoConfig?.version ?? '—')}
      </Text>
      <Text>{T.about.ai}</Text>
      <Text>{T.about.coins}</Text>
      <LegalLinks />
      {china && ICP_NUMBER && <Text style={formStyles.hint}>{T.about.icp(ICP_NUMBER)}</Text>}
      {china && APP_FILING_NUMBER && <Text style={formStyles.hint}>{T.about.appFiling(APP_FILING_NUMBER)}</Text>}
    </Sheet>
  );
}
