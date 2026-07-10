// End-to-end logic test against local Postgres via the shim.
// Verifies: schema applies, users seed, admin creates/assigns/deletes sessions,
// expert lists/opens/saves, export returns verbatim graph, conditional data survives.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { sql } from './pgshim.mjs';
import { splitStatements } from '../scripts/sqlutil.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); }
}

async function applySchema() {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  // drop first for idempotent test
  await sql.query('DROP TABLE IF EXISTS sessions CASCADE');
  await sql.query('DROP TABLE IF EXISTS users CASCADE');
  for (const s of splitStatements(raw)) await sql.query(s);
}

async function run() {
  console.log('Applying schema...');
  await applySchema();
  const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  check('tables created', tables.map(t => t.tablename).join(',') === 'sessions,users');

  // seed users
  const adminHash = bcrypt.hashSync('admin-pass', 10);
  const expertHash = bcrypt.hashSync('expert-pass', 10);
  await sql`INSERT INTO users (username,password_hash,role) VALUES ('petch',${adminHash},'admin')`;
  await sql`INSERT INTO users (username,password_hash,role) VALUES ('drsmith',${expertHash},'expert')`;
  const u = await sql`SELECT * FROM users WHERE username='petch'`;
  check('admin user seeded', u[0].role === 'admin');
  check('password verifies', bcrypt.compareSync('admin-pass', u[0].password_hash));
  check('wrong password rejected', !bcrypt.compareSync('nope', u[0].password_hash));

  // admin creates a session from a transcript
  const transcript = JSON.parse(
    fs.readFileSync('/mnt/project/demo1_transcript.json', 'utf8')
  ).map(t => ({ speaker: t.speaker, text: t.text }));
  await sql`INSERT INTO sessions (id,title,transcript) VALUES ('demo1','Demo 1',${JSON.stringify(transcript)}::jsonb)`;
  const s = await sql`SELECT id, jsonb_array_length(transcript) AS n, status FROM sessions WHERE id='demo1'`;
  check('session created', s[0].id === 'demo1');
  check('transcript length correct', s[0].n === transcript.length);
  check('default status is not started', s[0].status === 'not started');

  // assign to expert
  await sql`UPDATE sessions SET assigned_to='drsmith' WHERE id='demo1'`;
  // expert listing (assigned or unassigned)
  const list = await sql`
    SELECT id, assigned_to, jsonb_array_length(transcript) AS turn_count
    FROM sessions WHERE assigned_to='drsmith' OR assigned_to IS NULL`;
  check('expert sees assigned session', list.some(r => r.id === 'demo1'));

  // expert saves an annotation graph in the exact Neo4j-import shape
  const annotation = {
    nodes: [
      { id: 'cb_2', label: 'CoreBelief', parent: 'demo1',
        properties: { content: 'unlovable', domain: 'self', category: 'unlovable', derived: false },
        evidence: [1, 12] },
      { id: 'at_1', label: 'AutomaticThought', parent: 'demo1',
        properties: { content: 'I will never find love', modality: 'verbal', distortionType: 'fortuneTelling' },
        evidence: [1] },
    ],
    edges: [
      { type: 'stemsFrom', from: 'at_1', to: 'cb_2', evidence: [12] },
    ],
  };
  const uiState = { canvasPositions: { cb_2: { x: 340, y: 60 }, at_1: { x: 230, y: 230 } },
                    view: { panX: 40, panY: 20, scale: 1 } };
  await sql`UPDATE sessions
    SET annotation=${JSON.stringify(annotation)}::jsonb,
        ui_state=${JSON.stringify(uiState)}::jsonb,
        status='in progress', updated_at=now()
    WHERE id='demo1'`;

  // export = verbatim annotation blob
  const exp = await sql`SELECT annotation FROM sessions WHERE id='demo1'`;
  const g = exp[0].annotation;
  check('export has 2 nodes', g.nodes.length === 2);
  check('export has 1 edge', g.edges.length === 1);
  check('node shape matches pipeline format',
    g.nodes[0].id && g.nodes[0].label && g.nodes[0].properties && Array.isArray(g.nodes[0].evidence));
  check('edge shape matches pipeline format',
    g.edges[0].type === 'stemsFrom' && g.edges[0].from && g.edges[0].to && Array.isArray(g.edges[0].evidence));
  check('conditional property (category on self) preserved',
    g.nodes[0].properties.category === 'unlovable');
  check('multi-turn evidence preserved', JSON.stringify(g.nodes[0].evidence) === '[1,12]');
  check('canvas positions NOT in exported graph', !('canvasPos' in g.nodes[0]) && !('x' in g.nodes[0]));

  const ui = await sql`SELECT ui_state FROM sessions WHERE id='demo1'`;
  check('canvas positions stored separately', ui[0].ui_state.canvasPositions.cb_2.x === 340);
  check('status manually set to in progress',
    (await sql`SELECT status FROM sessions WHERE id='demo1'`)[0].status === 'in progress');

  // admin deletes
  await sql`DELETE FROM sessions WHERE id='demo1'`;
  const gone = await sql`SELECT 1 FROM sessions WHERE id='demo1'`;
  check('session deleted', gone.length === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  await sql._pool.end();
  process.exit(fail ? 1 : 0);
}
run().catch(e => { console.error('ERROR', e); process.exit(1); });
