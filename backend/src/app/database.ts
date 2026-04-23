"use server";

import mysql from 'mysql2/promise';

export async function seed() {
  try {
    const connection = await mysql.createConnection(process.env.DATABASE_URL!);
    await connection.ping();
    console.log("✅ SUCCESS: Database is actively connected and reachable!");
    await connection.end();
  } catch (error: any) {
    console.error("❌ ERROR: Could not connect to the database. Reason:", error.message);
  }
}

export async function execute(sql: string) {
  try {
    console.log("Executing SQL on local MySQL:", sql);
    
    // Create a connection to the local database
    const connection = await mysql.createConnection(process.env.DATABASE_URL!);
    
    // Execute the query
    const [rows] = await connection.query(sql);
    
    // Close the connection
    await connection.end();
    
    console.log("✅ Query successful!");
    return rows;
  } catch (error: any) {
    throw new Error(`SQL Syntax or Execution Error: ${error.message}`);
  }
}

export async function getSchema() {
  try {
    console.log("Fetching database schema...");
    const connection = await mysql.createConnection(process.env.DATABASE_URL!);
    const [tables]: any = await connection.query("SHOW TABLES");
    const dbName = process.env.DATABASE_URL!.split("/").pop()?.split("?")[0];

    let schemaStr = "";

    for (const row of tables) {
      const tableName = Object.values(row)[0] as string;

      // Get columns with key type
      const [columns]: any = await connection.query(`DESCRIBE \`${tableName}\``);
      const columnDefs = columns.map((col: any) => {
        if (col.Key === "PRI") return `${col.Field}(PK)`;
        if (col.Key === "MUL") return `${col.Field}(FK)`;
        return col.Field;
      }).join(", ");

      // Get foreign key relationships for this table
      const [fkRows]: any = await connection.query(`
        SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL
      `, [dbName, tableName]);

      let fkStr = "";
      if (fkRows.length > 0) {
        fkStr = " | FK: " + fkRows.map((fk: any) =>
          `${fk.COLUMN_NAME} -> ${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME}`
        ).join(", ");
      }

      schemaStr += `Table: ${tableName} (${columnDefs})${fkStr}\n`;
    }

    await connection.end();
    return schemaStr;
  } catch (error: any) {
    console.error("❌ ERROR: Could not fetch database schema:", error.message);
    return "Error fetching schema.";
  }
}