/**
 * Coin wallet backed by an immutable ledger (PRD §21). Every balance change
 * is one ledger row in the same transaction; balances can never go negative.
 */
import type { Db, Queryable } from '../db/db';

export type LedgerType = 'startingCoins' | 'handSettlement' | 'loginReward' | 'adminAdjustment';

export interface LedgerEntry {
  id: number;
  type: LedgerType;
  amount: number;
  balanceAfter: number;
  ref: string | null;
  meta: unknown;
  createdAt: string;
}

export interface WalletChange {
  /** Amount actually applied (a loss may be capped at the balance). */
  applied: number;
  requested: number;
  balance: number;
  /** True if this ref was already applied before (idempotent replay). */
  duplicate: boolean;
}

export class Wallet {
  constructor(private readonly db: Db) {}

  async balance(playerId: string, q: Queryable = this.db): Promise<number> {
    const rows = await q.query<{ balance: string }>('SELECT balance FROM wallets WHERE player_id = $1', [playerId]);
    return rows.length ? Number(rows[0].balance) : 0;
  }

  /** Creates the wallet with an opening ledger entry; used at account creation. */
  async open(q: Queryable, playerId: string, startingCoins: number): Promise<void> {
    await q.query('INSERT INTO wallets (player_id, balance) VALUES ($1, $2)', [playerId, startingCoins]);
    await q.query('INSERT INTO ledger (player_id, type, amount, balance_after) VALUES ($1, $2, $3, $3)', [playerId, 'startingCoins', startingCoins]);
  }

  /**
   * Applies `amount` (negative = loss). Losses are capped at the current
   * balance (PRD §21 balance floor). With a `ref`, applying the same
   * (type, ref) twice is a no-op, so settlements are safe to retry.
   */
  async apply(playerId: string, amount: number, type: LedgerType, ref: string | null, meta: unknown = null, q?: Queryable): Promise<WalletChange> {
    const run = async (t: Queryable): Promise<WalletChange> => {
      if (ref !== null) {
        const seen = await t.query<{ amount: string; balance_after: string }>(
          'SELECT amount, balance_after FROM ledger WHERE player_id = $1 AND type = $2 AND ref = $3',
          [playerId, type, ref],
        );
        if (seen.length) {
          return { applied: Number(seen[0].amount), requested: amount, balance: await this.balance(playerId, t), duplicate: true };
        }
      }
      const rows = await t.query<{ balance: string }>('SELECT balance FROM wallets WHERE player_id = $1 FOR UPDATE', [playerId]);
      if (!rows.length) throw new Error(`No wallet for ${playerId}`);
      const before = Number(rows[0].balance);
      const applied = Math.max(amount, -before);
      const after = before + applied;
      await t.query('UPDATE wallets SET balance = $2 WHERE player_id = $1', [playerId, after]);
      await t.query(
        'INSERT INTO ledger (player_id, type, amount, balance_after, ref, meta) VALUES ($1, $2, $3, $4, $5, $6)',
        [playerId, type, applied, after, ref, meta === null ? null : JSON.stringify(meta)],
      );
      return { applied, requested: amount, balance: after, duplicate: false };
    };
    return q ? run(q) : this.db.tx(run);
  }

  async history(playerId: string, limit = 50): Promise<LedgerEntry[]> {
    const rows = await this.db.query<{ id: string; type: LedgerType; amount: string; balance_after: string; ref: string | null; meta: unknown; created_at: Date | string }>(
      'SELECT id, type, amount, balance_after, ref, meta, created_at FROM ledger WHERE player_id = $1 ORDER BY id DESC LIMIT $2',
      [playerId, Math.min(Math.max(limit, 1), 200)],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      type: r.type,
      amount: Number(r.amount),
      balanceAfter: Number(r.balance_after),
      ref: r.ref,
      meta: r.meta,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }
}
