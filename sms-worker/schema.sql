-- SoMAp SMS (Mawasiliano) — Cloudflare D1 schema. Private to the Worker:
-- nothing here is ever visible through Firebase. Safe to run more than once.

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER,
  updated_by TEXT
);

-- Per-school SMS settings (who may send, limits, price).
CREATE TABLE IF NOT EXISTS school_settings (
  school_id TEXT PRIMARY KEY,
  allowed_roles TEXT NOT NULL DEFAULT '["admin","accountant"]',
  daily_limit INTEGER NOT NULL DEFAULT 1000,
  approval_above INTEGER NOT NULL DEFAULT 0,
  price_per_sms INTEGER,
  updated_at INTEGER,
  updated_by TEXT
);

-- Each school's own Sender ID (filled in Phase 6).
CREATE TABLE IF NOT EXISTS school_senders (
  school_id TEXT PRIMARY KEY,
  sender_id TEXT,
  status TEXT,
  is_usable INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER
);

-- Wallets in SMS units. 'test' = dry-run + sandbox, 'live' = real sends.
CREATE TABLE IF NOT EXISTS wallets (
  school_id TEXT NOT NULL,
  bucket TEXT NOT NULL CHECK (bucket IN ('test', 'live')),
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at INTEGER,
  PRIMARY KEY (school_id, bucket)
);

-- Every wallet change, forever.
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id TEXT NOT NULL,
  bucket TEXT NOT NULL,
  delta INTEGER NOT NULL,
  balance_after INTEGER,
  kind TEXT NOT NULL,          -- reserve | refund | adjust | topup | shortfall
  ref TEXT,
  note TEXT,
  actor TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_school ON ledger (school_id, bucket, created_at);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL,
  bucket TEXT NOT NULL,
  mode TEXT NOT NULL,          -- dryrun | sandbox | live
  purpose TEXT NOT NULL,
  name TEXT,
  sender_id TEXT,
  created_by TEXT NOT NULL,
  created_role TEXT,
  status TEXT NOT NULL,        -- open | closed
  est_recipients INTEGER,
  est_units INTEGER,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  units_used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS campaigns_school ON campaigns (school_id, created_at);

-- One row per browser chunk (~200 messages). The idempotency key makes retries safe.
CREATE TABLE IF NOT EXISTS chunks (
  campaign_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  school_id TEXT NOT NULL,
  idem_key TEXT NOT NULL,
  status TEXT NOT NULL,        -- reserved | unknown | done | failed
  units_reserved INTEGER NOT NULL DEFAULT 0,
  units_used INTEGER NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER,
  PRIMARY KEY (campaign_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  item_index INTEGER NOT NULL,
  school_id TEXT NOT NULL,
  bucket TEXT NOT NULL,
  msisdn TEXT,
  text TEXT,
  text_hash TEXT,
  ref TEXT,
  units_est INTEGER NOT NULL DEFAULT 0,
  units INTEGER,
  status TEXT NOT NULL,        -- pending | queued | sent | delivered | failed | rejected | unknown | dryrun
  gateway_uid TEXT,
  failure_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS messages_school_time ON messages (school_id, bucket, created_at);
CREATE INDEX IF NOT EXISTS messages_campaign ON messages (campaign_id, chunk_index);
CREATE INDEX IF NOT EXISTS messages_gateway ON messages (gateway_uid);
CREATE INDEX IF NOT EXISTS messages_phone ON messages (school_id, msisdn, created_at);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  event TEXT,
  received_at INTEGER NOT NULL
);

-- HQ live "pipe test" sends (to HQ test numbers only).
CREATE TABLE IF NOT EXISTS pipe_tests (
  id TEXT PRIMARY KEY,
  actor TEXT,
  msisdn TEXT,
  sender_id TEXT,
  text TEXT,
  status TEXT,
  gateway_uid TEXT,
  response TEXT,
  created_at INTEGER NOT NULL
);

-- Saved message templates (Violezo), per school. (Added in Phase 4.)
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_by TEXT,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS templates_school ON templates (school_id, updated_at);

INSERT OR IGNORE INTO config (key, value, updated_at, updated_by) VALUES
  ('mode', 'dryrun', 0, 'schema'),
  ('active_gateway', 'swalasms', 0, 'schema'),
  ('fallback_sender_id', '', 0, 'schema'),
  ('sandbox_sender_id', '', 0, 'schema'),
  ('buy_price_per_sms', '13', 0, 'schema');
