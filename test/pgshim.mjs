// Emulates @neondatabase/serverless's `sql` tagged-template + sql.query()
// using a local node-postgres pool, so we can test server logic locally.
import pg from 'pg';

const pool = new pg.Pool({
  host: '/tmp', port: 5433, user: 'postgres', database: 'postgres',
});

function toPgText(strings, values) {
  // Build "$1,$2" style parameterised query from template parts.
  let text = '';
  strings.forEach((s, i) => {
    text += s;
    if (i < values.length) text += '$' + (i + 1);
  });
  return { text, values };
}

export function sql(strings, ...values) {
  const { text, values: v } = toPgText(strings, values);
  return pool.query(text, v).then(r => r.rows);
}
// sql.query(str) used by initdb for raw DDL
sql.query = (str) => pool.query(str).then(r => r.rows);
sql._pool = pool;
