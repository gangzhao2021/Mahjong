/** Which sound a win makes, seen from my seat. Kept apart from sound.ts so it can be tested without audio. */
import type { WinRecord } from '@mahjong/engine';

export type WinSound = 'zimo' | 'hu' | 'dealIn' | 'otherZimo' | 'otherHu';

/** My own win; my discard won on (or my kong robbed); another player's self-draw (I pay too); or a win between others. */
export function winSound(win: Pick<WinRecord, 'seat' | 'selfDraw' | 'from'>, mySeat: number): WinSound {
  if (win.seat === mySeat) return win.selfDraw ? 'zimo' : 'hu';
  if (win.from === mySeat) return 'dealIn';
  return win.selfDraw ? 'otherZimo' : 'otherHu';
}
