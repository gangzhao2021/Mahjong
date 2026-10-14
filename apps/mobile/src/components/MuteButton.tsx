/** One-tap master mute for the lobby and the table: silences effects, music and speech. */
import { updateSoundSettings, useSoundSettings } from '../audio/sound';
import { T } from '../strings';
import { Btn } from './ActionBar';

export function MuteButton({ then }: { then?(): void }) {
  const { muted } = useSoundSettings();
  return (
    <Btn
      label={`${muted ? '🔇' : '🔊'} ${T.muteLabel(muted)}`}
      primary={muted}
      onPress={() => {
        then?.();
        void updateSoundSettings({ muted: !muted });
      }}
    />
  );
}
