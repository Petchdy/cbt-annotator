// Boot the real server with the pg shim and hit it over HTTP.
import { sql } from './pgshim.mjs';
// Inject the shim as the db module before importing the server.
import { register } from 'node:module';

// Simpler: monkeypatch by setting a global the db module can read is messy.
// Instead we replicate server wiring here but import the real route handlers
// is not trivial; so we spin the real app by overriding server/db.js via a
// loader. Easiest reliable path: import express app factory. Since index.js
// starts listening on import, we run it as a child with env pointing the shim.
// -> We instead test HTTP by starting index.js with a DATABASE_URL to local pg
//    through a tiny neon-compatible http shim is overkill.
//
// Pragmatic approach: start the real server as a subprocess using node's
// --import to replace the neon driver with our pg pool.

import bcrypt from 'bcryptjs';
import fs from 'fs';
import { splitStatements } from '../scripts/sqlutil.js';

const BASE = 'http://127.0.0.1:3999';
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };

async function seed() {
  const raw = fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
  await sql.query('DROP TABLE IF EXISTS sessions CASCADE');
  await sql.query('DROP TABLE IF EXISTS users CASCADE');
  for (const s of splitStatements(raw)) await sql.query(s);
  await sql`INSERT INTO users (username,password_hash,role)
            VALUES ('petch',${bcrypt.hashSync('pw-admin',10)},'admin')`;
  await sql`INSERT INTO users (username,password_hash,role)
            VALUES ('drsmith',${bcrypt.hashSync('pw-expert',10)},'expert')`;
  await sql._pool.end();
}

function cookieJar() {
  let cookie = '';
  return {
    async fetch(url, opts = {}) {
      const headers = { ...(opts.headers || {}) };
      if (cookie) headers.Cookie = cookie;
      const r = await fetch(BASE + url, { ...opts, headers });
      const sc = r.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      return r;
    },
    clear() { cookie = ''; },
  };
}

async function run() {
  await seed();

  // start real server as subprocess; db.js routes to the pg shim via DATABASE_URL
  const { spawn } = await import('node:child_process');
  const srv = spawn(process.execPath, ['server/index.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: '3999', JWT_SECRET: 'test', DATABASE_URL: 'pg-shim' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stdout.on('data', d => process.stdout.write('[srv] ' + d));
  srv.stderr.on('data', d => process.stderr.write('[srv-err] ' + d));

  // wait for boot
  await new Promise(r => setTimeout(r, 1500));

  try {
    const admin = cookieJar();
    // unauthenticated /me
    let r = await admin.fetch('/api/me');
    check('unauth /me is 401', r.status === 401);

    // bad login
    r = await admin.fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'petch', password: 'wrong' }) });
    check('bad login 401', r.status === 401);

    // good admin login
    r = await admin.fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'petch', password: 'pw-admin' }) });
    const me = await r.json();
    check('admin login ok', r.status === 200 && me.role === 'admin');

    // admin creates session
    const transcript = JSON.parse(fs.readFileSync('/mnt/project/demo1_transcript.json', 'utf8'))
      .map(t => ({ speaker: t.speaker, text: t.text }));
    r = await admin.fetch('/api/admin/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'demo1', title: 'Demo 1', transcript }) });
    check('admin create session', r.status === 200);

    // duplicate rejected
    r = await admin.fetch('/api/admin/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'demo1', title: 'dup', transcript }) });
    check('duplicate session 409', r.status === 409);

    // assign to expert
    r = await admin.fetch('/api/admin/sessions/demo1/assign', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assigned_to: 'drsmith' }) });
    check('assign to expert', r.status === 200);

    // admin sees experts list
    r = await admin.fetch('/api/admin/experts');
    const experts = await r.json();
    check('experts list has drsmith', experts.includes('drsmith'));

    // expert logs in (separate jar)
    const expert = cookieJar();
    r = await expert.fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'drsmith', password: 'pw-expert' }) });
    check('expert login ok', r.status === 200);

    // expert CANNOT hit admin route
    r = await expert.fetch('/api/admin/experts');
    check('expert blocked from admin route', r.status === 403);

    // expert lists sessions - sees demo1
    r = await expert.fetch('/api/sessions');
    const list = await r.json();
    check('expert sees assigned session', list.some(s => s.id === 'demo1'));
    check('turn_count present in list', list.find(s => s.id === 'demo1').turn_count === transcript.length);

    // expert opens session
    r = await expert.fetch('/api/sessions/demo1');
    const sess = await r.json();
    check('expert opens session with transcript', Array.isArray(sess.transcript) && sess.transcript.length > 0);

    // expert saves annotation
    const annotation = { nodes: [{ id: 'cb_2', label: 'CoreBelief', parent: 'demo1',
      properties: { content: 'unlovable', domain: 'self', category: 'unlovable' }, evidence: [1, 12] }], edges: [] };
    r = await expert.fetch('/api/sessions/demo1', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ annotation, ui_state: { canvasPositions: { cb_2: { x: 10, y: 20 } }, view: {} }, status: 'in progress' }) });
    check('expert saves annotation', r.status === 200);

    // export returns verbatim graph
    r = await expert.fetch('/api/sessions/demo1/export');
    const exp = await r.json();
    check('export returns graph', exp.nodes.length === 1 && exp.nodes[0].properties.category === 'unlovable');
    check('export has content-disposition',
      (r.headers.get('content-disposition') || '').includes('demo1_annotation.json'));

    // expert CANNOT create session (admin only)
    r = await expert.fetch('/api/admin/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'x', transcript: [] }) });
    check('expert blocked from creating session', r.status === 403);

  } finally {
    srv.kill();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
run().catch(e => { console.error(e); process.exit(1); });
