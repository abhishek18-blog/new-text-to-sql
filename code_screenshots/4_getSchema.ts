// ── Schema Fetcher: Relationship-Aware Context Injection ────────
// Fetches live schema + FK relationships from MySQL
// and formats them as structured context for LLM prompts

export async function getSchema(dbName?: string, addLog?: Function) {
  const connection = await mysql.createConnection(getDbUrl(dbName));
  const [tables]: any = await connection.query("SHOW TABLES");
  const actualDbName = dbUrl.split("/").pop()?.split("?")[0];

  let schemaStr = "";

  for (const row of tables) {
    const tableName = Object.values(row)[0] as string;

    // Columns with key types (PK / FK markers)
    const [cols]: any = await connection.query(`DESCRIBE \`${tableName}\``);
    const columnDefs  = cols.map((col: any) => {
      if (col.Key === "PRI") return `${col.Field}(PK)`;
      if (col.Key === "MUL") return `${col.Field}(FK)`;
      return col.Field;
    }).join(", ");

    // Foreign key relationships for join-awareness
    const [fkRows]: any = await connection.query(`
      SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
      FROM   INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE  TABLE_SCHEMA = ? AND TABLE_NAME = ?
        AND  REFERENCED_TABLE_NAME IS NOT NULL
    `, [actualDbName, tableName]);

    const fkStr = fkRows.length > 0
      ? " | FK: " + fkRows.map((fk: any) =>
          `${fk.COLUMN_NAME} -> ${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME}`
        ).join(", ")
      : "";

    schemaStr += `Table: ${tableName} (${columnDefs})${fkStr}\n`;
  }

  await connection.end();
  return schemaStr; // → injected directly into LLM system prompt
}
