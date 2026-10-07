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
];
