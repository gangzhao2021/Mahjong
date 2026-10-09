/** 设置: pace, voice callouts, sound, animations and tile size. */
import { Switch, Text, View } from 'react-native';
import { updateSoundSettings, useSoundSettings } from '../audio/sound';
import { Btn } from '../components/ActionBar';
import { formStyles, Sheet } from '../components/Sheet';
import { TILE_SCALES, updateSettings, useSettings } from '../settings';
import { T } from '../strings';

export function SettingsSheet({ onClose }: { onClose(): void }) {
  const settings = useSettings();
  const sound = useSoundSettings();
  const toggle = (label: string, value: boolean, onChange: (v: boolean) => void, hint?: string) => (
    <View>
      <View style={formStyles.row}>
        <Switch value={value} onValueChange={onChange} />
        <Text style={formStyles.label}>{label}</Text>
      </View>
      {hint ? <Text style={formStyles.hint}>{hint}</Text> : null}
    </View>
  );
  return (
    <Sheet title={T.settings.title} onClose={onClose} width={440}>
      {toggle(T.settings.fastPace, settings.fastPace, (v) => updateSettings({ fastPace: v }), T.settings.fastPaceHint)}
      {toggle(T.settings.voice, settings.voice, (v) => updateSettings({ voice: v }))}
      {toggle(T.sound.effects, sound.effects, (v) => updateSoundSettings({ effects: v }))}
      {toggle(T.sound.music, sound.music, (v) => updateSoundSettings({ music: v }))}
      {toggle(T.settings.animations, settings.animations, (v) => updateSettings({ animations: v }))}
      <View style={formStyles.row}>
        <Text style={formStyles.label}>{T.settings.tileSize}</Text>
        {TILE_SCALES.map((scale, i) => (
          <Btn key={scale} label={T.settings.tileSizes[i]} primary={settings.tileScale === scale} onPress={() => updateSettings({ tileScale: scale })} />
        ))}
      </View>
    </Sheet>
  );
}
