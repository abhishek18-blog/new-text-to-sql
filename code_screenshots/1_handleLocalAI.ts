// ── Fast-Path Local AI: 2-Call Pattern ──────────────────────────
// Instead of the slow ReAct agent loop (3+ LLM calls), we do:
//   1. Ask the LLM to produce ONLY raw SQL        (1 LLM call)
//   2. Execute it directly on our MySQL database
//   3. Ask the LLM to summarize in plain English  (1 LLM call)
// Result: 2 LLM calls instead of 5+ — optimized for local hardware

async function handleLocalAI(
  question: string, role: string, schemaStr: string, database?: string
) {
  const llm = new ChatOllama({
    baseUrl: "http://localhost:11434",
    model:   "llama3.2:latest",
    temperature: 0,
  });

  // Step 1 — Generate SQL only
  const sqlResponse = await llm.invoke([new HumanMessage(sqlPrompt)]);
  const rawSql = (sqlResponse.content as string).trim();

  // Step 2 — Sanitize & Execute SQL ourselves
  const cleanSql = rawSql
    .replace(/;\s*(LIMIT\s+\d+)/gi, ' $1')   // fix misplaced LIMIT
    .replace(/;+\s*$/g, '').trim();

  const rows = await execute(cleanSql, database);
  const results = JSON.parse(JSON.stringify(rows,
    (_, v) => typeof v === "bigint" ? v.toString() : v
  ));

  // Step 3 — Summarize result in plain English
  const summary = await llm.invoke([new HumanMessage(
    `User asked: "${question}"\nData: ${JSON.stringify(results?.slice(0, 5))}\nAnswer concisely.`
  )]);

  return { sql_query: cleanSql, results, answer: summary.content };
}
