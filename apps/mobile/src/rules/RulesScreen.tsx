/** 规则与番型: every fan pattern with an example hand, then the rules of 血战到底. */
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Btn } from '../components/ActionBar';
import { Felt } from '../components/Felt';
import { Melds } from '../components/TableParts';
import { Tile } from '../components/Tile';
import { PATTERN_NAMES, T, tr } from '../strings';
import { parseExample, PATTERNS, RULES } from './content';

export function RulesScreen({ onClose }: { onClose(): void }) {
  return (
    <Felt style={styles.root}>
      <View style={styles.header}>
        <Btn label={`‹ ${T.record.back}`} onPress={onClose} />
        <Text style={styles.title}>{T.rulesPage.pageTitle}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.section}>{T.rulesPage.patternsTitle}</Text>
        <View style={styles.patterns}>
          {PATTERNS.map((p) => {
            const example = p.example ? parseExample(p.example) : null;
            return (
              <View key={p.pattern} style={styles.pattern}>
                <View style={styles.patternHead}>
                  <Text style={styles.patternName}>{PATTERN_NAMES[p.pattern]}</Text>
                  <Text style={styles.fan}>{tr(p.fan)}</Text>
                </View>
                <Text style={styles.about}>{tr(p.about)}</Text>
                {example && (
                  <View style={styles.tiles}>
                    <Melds melds={example.melds} tileWidth={18} />
                    {example.hand.map((t, i) => (
                      <Tile key={i} tile={t} width={18} />
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </View>
        <Text style={styles.section}>{T.rulesPage.rulesTitle}</Text>
        {RULES.map((r) => (
          <View key={r.title.zh} style={styles.rule}>
            <Text style={styles.ruleTitle}>{tr(r.title)}</Text>
            <Text style={styles.ruleBody}>{tr(r.body)}</Text>
          </View>
        ))}
      </ScrollView>
    </Felt>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { color: '#fff8e1', fontSize: 20, fontWeight: '900' },
  body: { gap: 10, paddingBottom: 24, maxWidth: 980, width: '100%', alignSelf: 'center' },
  section: { color: '#ffe082', fontSize: 16, fontWeight: '900', marginTop: 6 },
  patterns: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pattern: { flexGrow: 1, flexBasis: 280, backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 12, padding: 10, gap: 4 },
  patternHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  patternName: { color: '#fff', fontSize: 16, fontWeight: '900' },
  fan: { color: '#ffd54f', fontWeight: '800' },
  about: { color: '#c8e6c9', fontSize: 13 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 1, marginTop: 2 },
  rule: { backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: 10, gap: 4 },
  ruleTitle: { color: '#fff', fontWeight: '900' },
  ruleBody: { color: '#e8f5e9', fontSize: 14, lineHeight: 21 },
});
