import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { sql } from '../server/db.js';
import { splitStatements } from './sqlutil.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Run each statement in schema.sql. Neon's http driver runs one statement per
// call, so we split on semicolons at statement boundaries.
async function run() {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  for (const stmt of splitStatements(raw)) {
    await sql.query(stmt);
  }
  console.log('Schema applied.');

  // Seed users from env. Change these before deploying.
  const admin = {
    username: process.env.ADMIN_USER || 'admin',
    password: process.env.ADMIN_PASS || 'changeme-admin',
  };
  const expert = {
    username: process.env.EXPERT_USER || 'expert',
    password: process.env.EXPERT_PASS || 'changeme-expert',
  };

  for (const [u, role] of [[admin, 'admin'], [expert, 'expert']]) {
    const hash = bcrypt.hashSync(u.password, 10);
    await sql`
      INSERT INTO users (username, password_hash, role)
      VALUES (${u.username}, ${hash}, ${role})
      ON CONFLICT (username) DO UPDATE SET password_hash = ${hash}, role = ${role}`;
    console.log(`User ready: ${u.username} (${role})`);
  }
  console.log('Done.');
}

run().catch(e => { console.error(e); process.exit(1); });
