// In production this uses Neon's serverless driver. For local testing, set
// DATABASE_URL=pg-shim to route through a standard node-postgres pool instead
// (see test/pgshim.mjs). Production behaviour is unchanged.
let sql;
if (process.env.DATABASE_URL === 'pg-shim') {
  ({ sql } = await import('../test/pgshim.mjs'));
} else {
  const { neon } = await import('@neondatabase/serverless');
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Point it at your Neon connection string.');
  }
  sql = neon(process.env.DATABASE_URL || '');
}
export { sql };
