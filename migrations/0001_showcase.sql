-- Spec 342, phase 1: the showcase lives in D1, its files in R2.
-- Votes arrive in a later migration (phase 3).

CREATE TABLE IF NOT EXISTS items (
  id          TEXT PRIMARY KEY,                    -- permanent: permalink + future vote key
  bench       TEXT NOT NULL,                       -- prompt-gallery | p5-sketch-gallery | svg-benchmark
  title       TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',            -- model label shown on the tile
  rating      TEXT NOT NULL DEFAULT '',            -- maintainer rating, e.g. "9/10"
  kind        TEXT NOT NULL,                       -- html | js | svg
  code_key    TEXT NOT NULL,                       -- R2 key of the current code revision
  prompt_key  TEXT,                                -- R2 key of the prompt text
  poster_key  TEXT,                                -- R2 key; null for SVG (the file is the art)
  status      TEXT NOT NULL DEFAULT 'published'
              CHECK (status IN ('published', 'hidden')),
  position    REAL NOT NULL,                       -- fractional sort order
  hero        INTEGER NOT NULL DEFAULT 0,          -- 1 = on the landing page
  cdn_hosts   TEXT NOT NULL DEFAULT '[]',          -- JSON list, disclosed to visitors
  source_meta TEXT NOT NULL DEFAULT '{}',          -- bench metadata snapshot at publish time
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS items_public ON items (status, position);

-- Append-only record of every admin change (phase 2 writes it; the seed
-- records its own import so the history starts at the beginning).
CREATE TABLE IF NOT EXISTS audit (
  seq     INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL,
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL,
  item_id TEXT,
  before  TEXT,
  after   TEXT
);
