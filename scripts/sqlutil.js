// Split a .sql file into individual statements.
// Strips `--` comments (full-line and trailing inline) first. Safe here
// because none of the schema's string literals contain a `--` sequence.
export function splitStatements(rawSql) {
  const noComments = rawSql
    .split('\n')
    .map(line => {
      const i = line.indexOf('--');
      return i >= 0 ? line.slice(0, i) : line;
    })
    .join('\n');
  return noComments
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);
}
