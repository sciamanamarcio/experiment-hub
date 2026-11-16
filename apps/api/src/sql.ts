/**
 * Builds "UPDATE <table> SET col = $1, ... WHERE id = $n RETURNING *".
 * Only fixed column names are interpolated into the SQL; every value is a parameter.
 */
export function buildUpdate(table: string, columns: [string, unknown][], id: string, extra = "") {
  const values: unknown[] = [];
  const sets = columns.map(([column, value]) => {
    values.push(value);
    return `${column} = $${values.length}`;
  });
  values.push(id);
  const sql = `UPDATE ${table} SET ${sets.join(", ")}${extra} WHERE id = $${values.length} RETURNING *`;
  return { sql, values };
}
