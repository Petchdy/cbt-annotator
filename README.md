# CBT KG Annotator

A web platform for annotating CBT knowledge graphs from therapy transcripts.
Transcript on the left, free-drag / pan / zoom canvas in the middle, and an
ontology-constrained inspector + coverage panel on the right. Built for the
v4_flat ontology, exports in the exact `{nodes, edges}` shape your Neo4j import
script already reads.

## What it does

- **Two roles.**
  - *Admin* (you): add/remove sessions, upload transcripts, assign sessions to
    an expert, and label yourself.
  - *Expert*: sees assigned (or unassigned) sessions, labels them, sets status.
- **Ontology-constrained labelling.** Node classes, property fields (with
  conditional fields like `category` only when `domain = self`), and edge types
  (with legal source/target classes) all come from `public/ontology.js`, the
  single source of truth. Only ontology-valid edges can be drawn.
- **Evidence linking.** Click "Edit" on a node's grounded turns, then click
  transcript turns to attach/detach them as evidence (multi-turn supported).
- **Coverage panel.** Live per-class counts, possible-orphan warnings (soft),
  and a list of turns with no grounded node yet.
- **Manual save** with an unsaved-changes guard on navigation and page close.
- **Neo4j export** per session — verbatim graph blob, downloadable or via
  `GET /api/sessions/:id/export`.

Session/Client/Utterance nodes are attached automatically on import and are not
part of manual labelling. Canvas positions and view state are stored separately
from the graph so they never pollute the Neo4j export.

## Architecture

- **Frontend**: vanilla ES modules (no build step) in `public/`.
- **Backend**: Node/Express in `server/`, serving both the API and the static
  frontend.
- **Database**: Neon (serverless Postgres). The annotation graph is stored
  verbatim as a JSONB blob (`sessions.annotation`) in the pipeline's import
  shape; UI-only state lives in `sessions.ui_state`.

## Setup

### 1. Create a Neon database
Sign up at neon.tech, create a project, copy the **pooled** connection string.

### 2. Configure environment
```bash
cp .env.example .env
# edit .env: paste DATABASE_URL, set JWT_SECRET, set ADMIN_/EXPERT_ credentials
```

### 3. Install and initialise
```bash
npm install
npm run initdb     # applies schema.sql, creates admin + expert users from .env
```

### 4. Seed transcripts (optional, admin can also upload via UI)
```bash
# single file (session id defaults to filename)
node scripts/seed.js path/to/demo1_transcript.json

# or a whole folder of *.json transcripts
node scripts/seed.js path/to/transcripts/
```
Transcripts are JSON arrays of `{ "speaker": "...", "text": "..." }`; the turn
index is the array position (turn 1 = first element).

### 5. Run
```bash
npm start
# open http://localhost:3000
```

## Deploy to Render

1. Push this repo to GitHub.
2. In Render, "New +" → "Blueprint", point it at the repo (`render.yaml` is
   included). Or create a Web Service manually: build `npm install`, start
   `npm start`.
3. Set env vars in the Render dashboard: `DATABASE_URL` (Neon pooled string),
   `ADMIN_USER`/`ADMIN_PASS`/`EXPERT_USER`/`EXPERT_PASS`. `JWT_SECRET` is
   auto-generated.
4. After first deploy, run `npm run initdb` once — either locally against the
   same `DATABASE_URL`, or via a Render one-off job / shell.

Note: the free plan sleeps after 15 minutes idle (~30s cold start). Fine for
solo research use; upgrade to a paid plan to remove.

## Importing into Neo4j

Each session's annotation is already in your pipeline's
`{id, label, parent, properties, evidence}` / `{type, from, to, evidence}`
format. Get it via:
```bash
curl -b cookies.txt http://localhost:3000/api/sessions/<id>/export > out.json
```
or the "Export" button in the labeler. Feed `out.json` to your existing import
script (minor path adjustments only, per the agreed plan).

## Ontology changes

Edit `public/ontology.js` only — classes, property schemas, edge rules, and
colours all live there and drive both the UI and validation. No other file
needs touching when the ontology evolves. Run `node test/ontology.mjs` after
edits to catch inconsistencies (missing colours, edges referencing unknown
classes, conditional fields pointing at non-existent keys).

## Tests

```bash
node test/ontology.mjs    # ontology internal consistency (no DB needed)
node test/frontcheck.mjs  # frontend module resolution
# DB tests need a local Postgres and DATABASE_URL=pg-shim wiring (see test/)
```

## Project layout

```
server/          Express API + auth + Neon driver
public/          Frontend (index.html, app.js, ontology.js, views/)
db/schema.sql    Postgres schema
scripts/         initdb (schema + users), seed (load transcripts)
test/            ontology / backend / http integration tests
render.yaml      Render deployment blueprint
```
