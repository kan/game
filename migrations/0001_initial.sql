-- Times are Unix epoch milliseconds (same as TAKO-SEN).

CREATE TABLE ids (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleting')),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE names (
  id TEXT PRIMARY KEY REFERENCES ids(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE transfer_codes (
  code TEXT PRIMARY KEY,
  id TEXT NOT NULL REFERENCES ids(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX transfer_codes_id ON transfer_codes (id);

CREATE TABLE recovery_codes (
  id TEXT PRIMARY KEY REFERENCES ids(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE migration_tokens (
  token_hash TEXT PRIMARY KEY,
  id TEXT NOT NULL REFERENCES ids(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX migration_tokens_id ON migration_tokens (id);
