import fs from 'fs';
import path from 'path';
import { sql } from '../server/db.js';

// Usage:
//   node scripts/seed.js <file-or-dir> [sessionId]
//
// - If given a .json file that is an array of {speaker,text}, inserts it as a
//   session (id defaults to the filename without extension, or the 2nd arg).
// - If given a directory, inserts every *.json array file it contains.

function loadTranscript(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error(`${file}: expected an array of {speaker,text}`);
  // normalise: keep only speaker + text, in order
  return data.map(t => ({ speaker: t.speaker, text: t.text }));
}

async function insert(id, title, transcript) {
  const exists = await sql`SELECT 1 FROM sessions WHERE id = ${id}`;
  if (exists.length) { console.log(`skip (exists): ${id}`); return; }
  await sql`INSERT INTO sessions (id, title, transcript)
            VALUES (${id}, ${title}, ${JSON.stringify(transcript)}::jsonb)`;
  console.log(`inserted: ${id} (${transcript.length} turns)`);
}

async function run() {
  const target = process.argv[2];
  const forcedId = process.argv[3];
  if (!target) { console.error('Provide a transcript file or directory.'); process.exit(1); }

  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    const files = fs.readdirSync(target).filter(f => f.endsWith('.json'));
    for (const f of files) {
      const id = path.basename(f, '.json');
      try { await insert(id, id, loadTranscript(path.join(target, f))); }
      catch (e) { console.error(`error on ${f}: ${e.message}`); }
    }
  } else {
    const id = forcedId || path.basename(target, '.json');
    await insert(id, id, loadTranscript(target));
  }
  console.log('Seeding complete.');
}

run().catch(e => { console.error(e); process.exit(1); });
