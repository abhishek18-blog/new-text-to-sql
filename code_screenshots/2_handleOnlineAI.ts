// ── Online AI: LangGraph ReAct Agent (Groq Cloud) ───────────────
// Uses a full ReAct agent loop — the agent autonomously decides
// WHEN and WHAT to query via the get_from_db tool

async function handleOnlineAI(
  question: string, role: string, schemaStr: string, database?: string
) {
  const llm = new ChatGroq({
    apiKey: process.env.GROQ_API_KEY,
    model:  "llama-3.1-8b-instant",
    temperature: 0,
  });

  // Tool: gives the agent direct MySQL access (read-only)
  const getFromDB = tool(
    async (input) => {
      const result = await execute(input.sql, database);
      return JSON.stringify(result,
        (key, value) => typeof value === "bigint" ? value.toString() : value
      );
    },
    {
      name: "get_from_db",
      description: "Get data from a MySQL database.",
      schema: z.object({
        sql: z.string().describe(
          "MySQL query — only use tables defined in the schema"
        ),
      }),
    }
  );

  // Spin up a ReAct agent: LLM + tools + recursion limit
  const agent = createReactAgent({ llm, tools: [getFromDB] });

  const response = await agent.invoke({
    messages: [
      new SystemMessage(`/* schema + RBAC + strict instructions */`),
      new HumanMessage(question),
    ],
  }, { recursionLimit: 40 });

  // Extract SQL used from tool calls + final answer
  const sql_query = extractSqlFromMessages(response.messages);
  const answer    = response.messages.at(-1)!.content;

  return { sql_query, results, answer };
}
