/** Schema migrations, applied in order and never edited once released. */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE players (
    id text PRIMARY KEY,
    nickname text NOT NULL,
    avatar text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    suspended_until timestamptz,
    banter_level text,
    token_version int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz,
    real_name_verified boolean NOT NULL DEFAULT false,
    birth_date date,
    id_hash text,
    reward_day int NOT NULL DEFAULT 0,
    last_reward_date date
  );

  CREATE TABLE identities (
    provider text NOT NULL,
    subject text NOT NULL,
    player_id text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    secret text,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, subject)
  );
  CREATE INDEX identities_player ON identities(player_id);

  CREATE TABLE wallets (
    player_id text PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    balance bigint NOT NULL CHECK (balance >= 0)
  );

  CREATE TABLE ledger (
    id bigserial PRIMARY KEY,
    player_id text NOT NULL,
    type text NOT NULL,
    amount bigint NOT NULL,
    balance_after bigint NOT NULL,
    ref text,
    meta jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX ledger_player ON ledger(player_id, created_at);
  CREATE UNIQUE INDEX ledger_ref ON ledger(player_id, type, ref) WHERE ref IS NOT NULL;

  CREATE TABLE pending_results (
    player_id text PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE guest_trials (
    device_id text PRIMARY KEY,
    started_at timestamptz NOT NULL
  );

  CREATE TABLE sms_codes (
    phone text PRIMARY KEY,
    code_hash text NOT NULL,
    expires_at timestamptz NOT NULL,
    attempts int NOT NULL DEFAULT 0,
    sent_at timestamptz NOT NULL
  )
  `,
  // Phase 4: long-term AI memory (PRD Appendix B). Rows are keyed by player so
  // account deletion removes them (ON DELETE CASCADE).
  `
  CREATE TABLE relationships (
    character_id text NOT NULL,
    player_id text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    games_together int NOT NULL DEFAULT 0,
    hands_together int NOT NULL DEFAULT 0,
    character_wins int NOT NULL DEFAULT 0,
    player_wins int NOT NULL DEFAULT 0,
    dealt_in_by_player int NOT NULL DEFAULT 0,
    dealt_in_to_player int NOT NULL DEFAULT 0,
    points_net bigint NOT NULL DEFAULT 0,
    rivalry real NOT NULL DEFAULT 0,
    grudge_reason text,
    grudge_strength real NOT NULL DEFAULT 0,
    grudge_at timestamptz,
    last_seen_at timestamptz,
    PRIMARY KEY (character_id, player_id)
  );
  CREATE INDEX relationships_player ON relationships(player_id);

  CREATE TABLE memory_events (
    id bigserial PRIMARY KEY,
    character_id text,
    player_id text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    kind text NOT NULL,
    summary text NOT NULL,
    importance real NOT NULL,
    game_id text,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_referenced_at timestamptz,
    reference_count int NOT NULL DEFAULT 0
  );
  CREATE INDEX memory_events_player ON memory_events(player_id, character_id);

  CREATE TABLE player_profiles (
    player_id text PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    hands_played int NOT NULL DEFAULT 0,
    games_played int NOT NULL DEFAULT 0,
    deal_ins int NOT NULL DEFAULT 0,
    wins int NOT NULL DEFAULT 0,
    self_draws int NOT NULL DEFAULT 0,
    big_wins int NOT NULL DEFAULT 0,
    hua_zhu int NOT NULL DEFAULT 0,
    chat_messages int NOT NULL DEFAULT 0,
    play_style text,
    habits jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
  )
  `,
  // Phase 5: admin dashboard (PRD §28–§38, Appendix D.5).
  `
  ALTER TABLE players ADD COLUMN suspension_reason text;

  CREATE TABLE settings (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE admin_sessions (
    token_hash text PRIMARY KEY,
    ip text,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE admin_audit (
    id bigserial PRIMARY KEY,
    action text NOT NULL,
    target text,
    detail jsonb,
    ip text,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX admin_audit_time ON admin_audit(created_at);

  CREATE TABLE play_sessions (
    id bigserial PRIMARY KEY,
    player_id text NOT NULL,
    started_at timestamptz NOT NULL,
    ended_at timestamptz
  );
  CREATE INDEX play_sessions_started ON play_sessions(started_at);

  CREATE TABLE moderation_events (
    id bigserial PRIMARY KEY,
    kind text NOT NULL,
    player_id text,
    character_id text,
    text text NOT NULL,
    reason text,
    game_id text,
    status text NOT NULL DEFAULT 'open',
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX moderation_events_status ON moderation_events(status, created_at)
  `,
  // Phase 6: client crash reports.
  `
  CREATE TABLE client_errors (
    id bigserial PRIMARY KEY,
    fingerprint text NOT NULL,
    message text NOT NULL,
    stack text,
    platform text,
    app_version text,
    player_id text,
    context jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX client_errors_fingerprint ON client_errors(fingerprint, created_at)
  `,
  // In-progress games survive a server restart.
  `
  CREATE TABLE active_games (
    player_id text PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    game_id text NOT NULL,
    state jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )
  `,
  // Login and chat logs (Appendix D.6): kept for the retention period, then purged.
  `
  CREATE TABLE login_events (
    id bigserial PRIMARY KEY,
    player_id text NOT NULL,
    method text NOT NULL,
    ip text,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX login_events_created ON login_events(created_at);
  CREATE INDEX login_events_player ON login_events(player_id, created_at);
  CREATE TABLE chat_log (
    id bigserial PRIMARY KEY,
    player_id text NOT NULL,
    game_id text NOT NULL,
    seat int NOT NULL,
    kind text NOT NULL,
    speaker text NOT NULL,
    text text,
    sticker text,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX chat_log_created ON chat_log(created_at);
  CREATE INDEX chat_log_player ON chat_log(player_id, created_at)
  `,
  // Each player's finished hands, for the in-app replay and history list; purged with the hand logs.
  `
  CREATE TABLE hand_history (
    player_id text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    game_id text NOT NULL,
    hand_index int NOT NULL,
    log jsonb NOT NULL,
    ended_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (player_id, game_id, hand_index)
  );
  CREATE INDEX hand_history_recent ON hand_history(player_id, ended_at DESC)
  `,
];
