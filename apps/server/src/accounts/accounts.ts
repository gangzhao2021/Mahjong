/**
 * Accounts (PRD §19–§20, §22, §31): identities from every login method map to
 * one player; guests upgrade in place by linking; deletion removes personal
 * data and anonymizes the coin ledger.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Db, Queryable } from '../db/db';
import type { Wallet } from '../economy/wallet';
import type { SessionTokens } from './tokens';

export type Provider = 'guest' | 'apple' | 'google' | 'phone' | 'wechat';
export const PROVIDERS: readonly Provider[] = ['guest', 'apple', 'google', 'phone', 'wechat'];

export const PLAYER_AVATARS = ['🙂', '😎', '🐼', '🦊', '🐯', '🐸', '🐵', '🐧', '🐰', '🐻', '🐨', '🦁'];

export interface PlayerRow {
  id: string;
  nickname: string;
  avatar: string;
  status: 'active' | 'suspended';
  suspended_until: Date | string | null;
  banter_level: 'mild' | 'spicy' | 'quiet' | null;
  token_version: number;
  created_at: Date | string;
  last_login_at: Date | string | null;
  real_name_verified: boolean;
  birth_date: Date | string | null;
  id_hash: string | null;
  reward_day: number;
  last_reward_date: Date | string | null;
}

export class AccountSuspendedError extends Error {
  constructor(readonly until: Date | null) {
    super('Account suspended');
  }
}

export type LinkResult = { status: 'linked' } | { status: 'alreadyLinked' } | { status: 'conflict'; otherPlayerId: string };

export class Accounts {
  constructor(
    private readonly db: Db,
    private readonly wallet: Wallet,
    private readonly tokens: SessionTokens,
    private readonly startingCoins: () => number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Logs in with an identity, creating the account (and its starting coins) on first use. */
  async login(provider: Provider, subject: string, secret?: string | null): Promise<{ player: PlayerRow; token: string; created: boolean }> {
    const { player, created } = await this.db.tx(async (q) => {
      const found = await q.query<PlayerRow>(
        'SELECT p.* FROM identities i JOIN players p ON p.id = i.player_id WHERE i.provider = $1 AND i.subject = $2',
        [provider, subject],
      );
      if (found.length) {
        if (secret) await q.query('UPDATE identities SET secret = $3 WHERE provider = $1 AND subject = $2', [provider, subject, secret]);
        return { player: found[0], created: false };
      }
      const id = `p_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const nickname = `玩家${id.slice(-4)}`;
      const avatar = PLAYER_AVATARS[Math.floor(Math.random() * PLAYER_AVATARS.length)];
      const rows = await q.query<PlayerRow>('INSERT INTO players (id, nickname, avatar) VALUES ($1, $2, $3) RETURNING *', [id, nickname, avatar]);
      await q.query('INSERT INTO identities (provider, subject, player_id, secret) VALUES ($1, $2, $3, $4)', [provider, subject, id, secret ?? null]);
      // Same starting coins for every login method (PRD §22).
      await this.wallet.open(q, id, this.startingCoins());
      return { player: rows[0], created: true };
    });

    const active = await this.ensureActive(player);
    await this.db.query('UPDATE players SET last_login_at = $2 WHERE id = $1', [player.id, this.now()]);
    return { player: active, token: this.tokens.sign(player.id, player.token_version), created };
  }

  /** Resolves a session token to an active player, or null. */
  async authenticate(token: unknown): Promise<PlayerRow | null> {
    const claims = this.tokens.verify(token);
    if (!claims) return null;
    const player = await this.get(claims.playerId);
    if (!player || player.token_version !== claims.version) return null;
    try {
      return await this.ensureActive(player);
    } catch {
      return null;
    }
  }

  async get(playerId: string, q: Queryable = this.db): Promise<PlayerRow | null> {
    const rows = await q.query<PlayerRow>('SELECT * FROM players WHERE id = $1', [playerId]);
    return rows[0] ?? null;
  }

  async providers(playerId: string): Promise<Provider[]> {
    const rows = await this.db.query<{ provider: Provider }>('SELECT provider FROM identities WHERE player_id = $1 ORDER BY created_at', [playerId]);
    return rows.map((r) => r.provider);
  }

  async updateProfile(playerId: string, patch: { nickname?: string; avatar?: string; banterLevel?: PlayerRow['banter_level'] }): Promise<PlayerRow> {
    const sets: string[] = [];
    const params: unknown[] = [playerId];
    const add = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };
    if (patch.nickname !== undefined) add('nickname', patch.nickname);
    if (patch.avatar !== undefined) add('avatar', patch.avatar);
    if (patch.banterLevel !== undefined) add('banter_level', patch.banterLevel);
    if (!sets.length) return (await this.get(playerId))!;
    const rows = await this.db.query<PlayerRow>(`UPDATE players SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
    return rows[0];
  }

  /**
   * Links another login method to this account (guest upgrade, PRD §19).
   * If the identity already belongs to a different account, nothing changes:
   * the client asks the player whether to switch to that account instead.
   */
  async link(playerId: string, provider: Provider, subject: string, secret?: string | null): Promise<LinkResult> {
    return this.db.tx(async (q) => {
      const owner = await q.query<{ player_id: string }>('SELECT player_id FROM identities WHERE provider = $1 AND subject = $2', [provider, subject]);
      if (owner.length) {
        return owner[0].player_id === playerId ? { status: 'alreadyLinked' as const } : { status: 'conflict' as const, otherPlayerId: owner[0].player_id };
      }
      const existing = await q.query('SELECT 1 FROM identities WHERE player_id = $1 AND provider = $2', [playerId, provider]);
      if (existing.length && provider !== 'guest') {
        // One Apple / Google / phone / WeChat identity per account.
        await q.query('DELETE FROM identities WHERE player_id = $1 AND provider = $2', [playerId, provider]);
      }
      await q.query('INSERT INTO identities (provider, subject, player_id, secret) VALUES ($1, $2, $3, $4)', [provider, subject, playerId, secret ?? null]);
      return { status: 'linked' as const };
    });
  }

  async identitySecrets(playerId: string): Promise<{ provider: Provider; subject: string; secret: string | null }[]> {
    return this.db.query('SELECT provider, subject, secret FROM identities WHERE player_id = $1', [playerId]);
  }

  /**
   * Deletes the account (PRD §19): profile, identities, wallet and pending
   * results go; ledger rows stay for the audit trail with the player
   * reference anonymized. Existing sessions become invalid.
   */
  async delete(playerId: string): Promise<void> {
    const anonymous = `deleted:${createHash('sha256').update(playerId).digest('hex').slice(0, 16)}`;
    await this.db.tx(async (q) => {
      await q.query('UPDATE ledger SET player_id = $2, meta = NULL WHERE player_id = $1', [playerId, anonymous]);
      // Aggregated analytics stay, but no longer point at the person (PRD §19).
      await q.query('UPDATE play_sessions SET player_id = $2 WHERE player_id = $1', [playerId, anonymous]);
      await q.query('UPDATE moderation_events SET player_id = $2 WHERE player_id = $1', [playerId, anonymous]);
      await q.query('DELETE FROM players WHERE id = $1', [playerId]);
    });
  }

  async setRealName(playerId: string, birthDate: string, idHash: string): Promise<void> {
    await this.db.query('UPDATE players SET real_name_verified = true, birth_date = $2, id_hash = $3 WHERE id = $1', [playerId, birthDate, idHash]);
  }

  private async ensureActive(player: PlayerRow): Promise<PlayerRow> {
    if (player.status !== 'suspended') return player;
    const until = player.suspended_until ? new Date(player.suspended_until) : null;
    if (until && until <= this.now()) {
      const rows = await this.db.query<PlayerRow>("UPDATE players SET status = 'active', suspended_until = NULL WHERE id = $1 RETURNING *", [player.id]);
      return rows[0];
    }
    throw new AccountSuspendedError(until);
  }
}
