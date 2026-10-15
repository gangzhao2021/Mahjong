/** What 「再来一场」 starts: the same table again, even when the app was reloaded mid-game. */
import type { AiLevel, GameOptions, StakeInfo } from '@mahjong/protocol';

/**
 * A public table is rebuilt from the game's own stake, so a game restored after the app restarted
 * goes back to its table (not the practice default); the practice table keeps the player's AI level.
 * Private and friend rooms can't be rebuilt from the table, so they reuse the options last sent.
 */
export function nextGameOptions(stake: StakeInfo, last: GameOptions, practiceAiLevel: AiLevel | null): GameOptions {
  if (stake.kind !== 'public' || !stake.tableId) return last;
  return stake.multiplier === 0 && practiceAiLevel ? { tableId: stake.tableId, aiLevel: practiceAiLevel } : { tableId: stake.tableId };
}
