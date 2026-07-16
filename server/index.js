import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sql } from './db.js';
import {
  signToken, setAuthCookie, clearAuthCookie,
  authOptional, requireAuth, requireAdmin,
} from './auth.js';
import { buildExportPayload } from '../public/exportPayload.js';
import { SUPPORTED_LANGUAGES } from '../public/ontology.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '4mb' }));
app.use(cookieParser());
app.use(authOptional);

// Wrap an async handler so a rejected promise becomes an Express error
// (→ 500 via the error handler below) instead of an unhandled rejection that
// would crash the process. Every async route is registered through this.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ── Auth ──────────────────────────────────────────────────────────────────

app.post('/api/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });
  const rows = await sql`SELECT * FROM users WHERE username = ${username}`;
  const user = rows[0];
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  setAuthCookie(res, signToken(user));
  res.json({ username: user.username, role: user.role });
}));

app.post('/api/logout', (_req, res) => { clearAuthCookie(res); res.json({ ok: true }); });

app.get('/api/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ username: req.user.username, role: req.user.role });
});

// ── Sessions (list / open / save) ──────────────────────────────────────────

// List sessions. Admin sees all; experts see only sessions assigned to them.
app.get('/api/sessions', requireAuth, wrap(async (req, res) => {
  let rows;
  if (req.user.role === 'admin') {
    rows = await sql`
      SELECT id, title, status, assigned_to,
             jsonb_array_length(transcript) AS turn_count,
             updated_at
      FROM sessions ORDER BY updated_at DESC`;
  } else {
    rows = await sql`
      SELECT id, title, status, assigned_to,
             jsonb_array_length(transcript) AS turn_count,
             updated_at
      FROM sessions
      WHERE assigned_to = ${req.user.username}
      ORDER BY updated_at DESC`;
  }
  res.json(rows);
}));

// Open a single session: transcript + annotation graph + ui state.
app.get('/api/sessions/:id', requireAuth, wrap(async (req, res) => {
  const rows = await sql`SELECT * FROM sessions WHERE id = ${req.params.id}`;
  const s = rows[0];
  if (!s) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && s.assigned_to !== req.user.username) {
    return res.status(403).json({ error: 'Not assigned to you' });
  }
  res.json({
    id: s.id, title: s.title, transcript: s.transcript,
    annotation: s.annotation, ui_state: s.ui_state, status: s.status,
    assigned_to: s.assigned_to,
    language: s.language, notes: s.notes,
    updated_at: s.updated_at,
  });
}));

// Save annotation graph + ui state + status (manual save from the labeller).
app.put('/api/sessions/:id', requireAuth, wrap(async (req, res) => {
  const { annotation, ui_state, status, language, notes } = req.body || {};
  const rows = await sql`SELECT assigned_to, language FROM sessions WHERE id = ${req.params.id}`;
  const s = rows[0];
  if (!s) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && s.assigned_to !== req.user.username) {
    return res.status(403).json({ error: 'Not assigned to you' });
  }
  const validStatus = ['not started', 'in progress', 'done'].includes(status) ? status : 'in progress';
  const validLang = SUPPORTED_LANGUAGES.includes(language) ? language : s.language;
  const cleanNotes = Array.isArray(notes)
    ? notes.map(n => String(n)).filter(n => n.trim().length > 0)
    : null;
  if (cleanNotes) {
    await sql`
      UPDATE sessions
      SET annotation = ${JSON.stringify(annotation)}::jsonb,
          ui_state   = ${JSON.stringify(ui_state)}::jsonb,
          status     = ${validStatus},
          language   = ${validLang},
          notes      = ${JSON.stringify(cleanNotes)}::jsonb,
          updated_at = now()
      WHERE id = ${req.params.id}`;
  } else {
    await sql`
      UPDATE sessions
      SET annotation = ${JSON.stringify(annotation)}::jsonb,
          ui_state   = ${JSON.stringify(ui_state)}::jsonb,
          status     = ${validStatus},
          language   = ${validLang},
          updated_at = now()
      WHERE id = ${req.params.id}`;
  }
  res.json({ ok: true });
}));

// Neo4j-import export: build the ontology_v4_flat gold-annotation shape.
app.get('/api/sessions/:id/export', requireAuth, wrap(async (req, res) => {
  const rows = await sql`SELECT * FROM sessions WHERE id = ${req.params.id}`;
  const s = rows[0];
  if (!s) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && s.assigned_to !== req.user.username) {
    return res.status(403).json({ error: 'Not assigned to you' });
  }
  const payload = buildExportPayload({
    sessionId: s.id,
    title: s.title,
    transcript: s.transcript,
    annotation: s.annotation,
    assignedTo: s.assigned_to,
    language: s.language,
    notes: s.notes,
    updatedAt: s.updated_at instanceof Date ? s.updated_at.toISOString() : s.updated_at,
  });
  res.setHeader('Content-Disposition', `attachment; filename="${s.id}_annotation.json"`);
  res.json(payload);
}));

// ── Admin: manage sessions and assignment ──────────────────────────────────

// Create a session from an uploaded transcript array [{speaker,text}, ...].
app.post('/api/admin/sessions', requireAdmin, wrap(async (req, res) => {
  const { id, title, transcript } = req.body || {};
  if (!id || !Array.isArray(transcript)) {
    return res.status(400).json({ error: 'id and transcript[] required' });
  }
  const exists = await sql`SELECT 1 FROM sessions WHERE id = ${id}`;
  if (exists.length) return res.status(409).json({ error: 'Session id already exists' });
  await sql`
    INSERT INTO sessions (id, title, transcript)
    VALUES (${id}, ${title || id}, ${JSON.stringify(transcript)}::jsonb)`;
  res.json({ ok: true });
}));

// Delete a session (removes its transcript + annotation).
app.delete('/api/admin/sessions/:id', requireAdmin, wrap(async (req, res) => {
  await sql`DELETE FROM sessions WHERE id = ${req.params.id}`;
  res.json({ ok: true });
}));

// Assign / unassign a session to an expert.
app.put('/api/admin/sessions/:id/assign', requireAdmin, wrap(async (req, res) => {
  const { assigned_to } = req.body || {};
  await sql`UPDATE sessions SET assigned_to = ${assigned_to || null}, updated_at = now()
            WHERE id = ${req.params.id}`;
  res.json({ ok: true });
}));

// List assignable users for the assignment dropdown: experts plus the current admin.
app.get('/api/admin/experts', requireAdmin, wrap(async (_req, res) => {
  const rows = await sql`
    SELECT username FROM users
    WHERE role = 'expert' OR username = ${_req.user.username}
    ORDER BY CASE WHEN username = ${_req.user.username} THEN 0 ELSE 1 END, username`;
  res.json(rows.map(r => r.username));
}));

// ── Error handling ──────────────────────────────────────────────────────────
// Any error thrown in a wrapped handler lands here → 500, process stays up.
app.use((err, _req, res, _next) => {
  console.error('Request error:', err.message);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Server error' });
});

// Last-resort guards so a stray rejection/exception never kills the server.
process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e));
process.on('uncaughtException', (e) => console.error('Uncaught exception:', e));

// ── Static frontend ─────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CBT annotator listening on :${PORT}`));
