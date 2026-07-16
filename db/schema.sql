-- ─────────────────────────────────────────────────────────────────────────
-- CBT annotation platform — Neon/Postgres schema
--
-- Design choice (option "b"): the Neo4j-importable graph is stored verbatim
-- as a JSONB blob in `annotation`, in the exact {nodes, edges} shape the
-- existing pipeline import script reads. UI-only state (canvas positions)
-- lives in a separate JSONB column so it never pollutes the graph export.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','expert')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,               -- e.g. 'demo1_transcript'
  title         TEXT NOT NULL,
  transcript    JSONB NOT NULL,                 -- [{speaker, text}, ...]; turn index = array position
  -- annotation graph, verbatim Neo4j-import shape: { nodes: [...], edges: [...] }
  annotation    JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  -- UI-only state, never exported to Neo4j: { canvasPositions: {nodeId:{x,y}}, view:{panX,panY,scale} }
  ui_state      JSONB NOT NULL DEFAULT '{"canvasPositions":{},"view":{"panX":40,"panY":20,"scale":1}}'::jsonb,
  -- status is set MANUALLY by the labeller, never derived
  status        TEXT NOT NULL DEFAULT 'not started'
                CHECK (status IN ('not started','in progress','done')),
  assigned_to   TEXT,                           -- username of expert this is queued for (nullable)
  language      TEXT NOT NULL DEFAULT 'english',
  notes         JSONB NOT NULL DEFAULT '[]'::jsonb, -- array of annotator notes (gold_notes in export)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent additive migration for existing databases created before language/notes existed.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'english',
  ADD COLUMN IF NOT EXISTS notes    JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_assigned ON sessions(assigned_to);
