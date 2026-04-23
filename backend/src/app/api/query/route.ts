import { NextResponse } from "next/server";

import { ChatGroq } from "@langchain/groq";
import { ChatOllama } from "@langchain/ollama";

import { createReactAgent } from "@langchain/langgraph/prebuilt";

import { tool } from "@langchain/core/tools";

import { z } from "zod";

import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";

import { execute, seed, getSchema } from "../../database";

export const maxDuration = 60;

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

// ─── Fast path for Local AI ───────────────────────────────────────────────────
// Instead of the slow ReAct agent loop (3+ LLM calls), we do:
//   1. Ask the LLM to produce ONLY a raw SQL query (1 LLM call)
//   2. We execute it ourselves
//   3. Ask the LLM to summarize the result in plain English (1 LLM call)
// Total: 2 LLM calls instead of 5+
async function handleLocalAI(question: string, role: string, schemaStr: string) {
  const llm = new ChatOllama({
    baseUrl: "http://localhost:11434",
    model: "llama3.2:latest",
    temperature: 0,
  });

  const privacyRule = role.toLowerCase() === "user"
    ? `If the question asks for personal details (names, emails, addresses, specific people), reply with exactly: "You need to be an admin to access this data." and no SQL.`
    : `The user is an ADMIN and can access all data.`;

  // Step 1: Generate SQL
  const sqlPrompt = `You are a MySQL query generator. Your ONLY job is to write valid MySQL SQL.

STRICT RULES — FOLLOW EXACTLY:
1. Output ONLY the raw SQL query. No explanation, no markdown, no code fences, no comments.
2. ONLY use table names and column names that are listed in the Schema below. NEVER invent column names.
3. Date columns in this database store ISO 8601 strings like '2015-06-01T04:45:00.000Z'. To filter by date, use: departure LIKE '2015-06-01%'
4. Do NOT use DATE(), from, log_date, or any column not in the Schema.
5. Do NOT add a semicolon before LIMIT. The correct format is: SELECT ... WHERE ... LIMIT 100
6. Do NOT alias columns unless necessary.
7. If the question is a greeting or unrelated to the database, output exactly: NOT_A_QUERY
8. ${privacyRule}
9. ALWAYS use IN instead of = when comparing against a subquery. Example: WHERE flight_id IN (SELECT ...) NOT WHERE flight_id = (SELECT ...)

Schema:
${schemaStr}

Question: ${question}
SQL:`;

  const sqlResponse = await llm.invoke([new HumanMessage(sqlPrompt)]);
  const rawSql = (sqlResponse.content as string).trim();

  // Handle non-query responses
  if (rawSql === "NOT_A_QUERY" || rawSql.toLowerCase().includes("you need to be an admin")) {
    return {
      sql_query: null,
      results: null,
      answer: rawSql === "NOT_A_QUERY"
        ? "Hello! I'm your SQL assistant. Ask me anything about your database."
        : "You need to be an admin to access this data.",
    };
  }

  // Step 2: Sanitize SQL — fix common LLM mistakes
  // e.g. "SELECT ... WHERE ...;  LIMIT 100" → "SELECT ... WHERE ... LIMIT 100"
  const cleanSql = rawSql
    .replace(/;\s*(LIMIT\s+\d+)/gi, ' $1')  // move misplaced LIMIT after semicolon
    .replace(/;+\s*$/g, '')                   // strip trailing semicolons
    .trim();

  // Step 3: Execute the SQL ourselves
  let results: any[] | null = null;
  let executionError: string | null = null;
  try {
    const rows = await execute(cleanSql) as any[];
    results = JSON.parse(JSON.stringify(rows, (_, v) => typeof v === "bigint" ? v.toString() : v));
  } catch (e: any) {
    executionError = e.message;
  }

  // Step 3b: Retry once with the error so the model can self-correct
  if (executionError) {
    console.warn("⚠️ Local AI SQL failed, retrying with error context...");
    const retryPrompt = `${sqlPrompt}

Your previous attempt was:
${cleanSql}

It failed with error: ${executionError}

Fix the SQL and output ONLY the corrected raw SQL query:`;
    const retryResponse = await llm.invoke([new HumanMessage(retryPrompt)]);
    const retrySql = (retryResponse.content as string).trim()
      .replace(/;\s*(LIMIT\s+\d+)/gi, ' $1')
      .replace(/;+\s*$/g, '')
      .trim();

    try {
      const rows = await execute(retrySql) as any[];
      results = JSON.parse(JSON.stringify(rows, (_, v) => typeof v === "bigint" ? v.toString() : v));
      executionError = null;
      return {
        sql_query: retrySql,
        results,
        answer: await (async () => {
          const s = await llm.invoke([new HumanMessage(
            `You are a helpful data analyst. The user asked: "${question}"\nThe SQL returned: ${JSON.stringify(results?.slice(0, 5))}\nGive a short plain English answer. No SQL, no raw data.`
          )]);
          return (s.content as string).trim();
        })(),
      };
    } catch (e: any) {
      return {
        sql_query: retrySql,
        results: null,
        answer: `I couldn't generate a valid SQL query for this question. Error: ${e.message}`,
      };
    }
  }

  // Step 4: Summarize the result in plain English
  const summaryPrompt = `You are a helpful data analyst. The user asked: "${question}"
The SQL query returned these results: ${JSON.stringify(results?.slice(0, 5))}
Give a short, direct, plain English answer. Do NOT mention SQL or raw data. Just answer the question.`;

  const summaryResponse = await llm.invoke([new HumanMessage(summaryPrompt)]);
  const answer = (summaryResponse.content as string).trim();

  return { sql_query: cleanSql, results, answer };
}

// ─── Online AI path (unchanged – uses full ReAct agent) ────────────────────
async function handleOnlineAI(question: string, role: string, schemaStr: string) {
  const llm = new ChatGroq({
    apiKey: process.env.GROQ_API_KEY,
    model: "llama-3.1-8b-instant",
    temperature: 0,
  });

  const getFromDB = tool(
    async (input) => {
      if (input?.sql) {
        try {
          const result = await execute(input.sql);
          return JSON.stringify(result, (key, value) =>
            typeof value === "bigint" ? value.toString() : value
          );
        } catch (e: any) {
          return `Error executing query: ${e.message}`;
        }
      }
      return null;
    },
    {
      name: "get_from_db",
      description: "Get data from a MySQL database.",
      schema: z.object({
        sql: z.string().describe("MySQL query to get data from the database. Do not use generic table names, only use the tables provided in the schema."),
      }),
    }
  );

  const agent = createReactAgent({ llm, tools: [getFromDB] });

  const response = await agent.invoke({
    messages: [
      new SystemMessage(`You are a strict MySQL database assistant.

CRITICAL INSTRUCTIONS:
1. You MUST use the 'get_from_db' tool to fetch the exact data BEFORE answering any user question.
2. NEVER guess, estimate, or hallucinate numbers or data.
3. Only use standard MySQL syntax. ALWAYS add LIMIT 100 to your queries unless a specific limit is requested.
4. If user asks for any data that is not in the database, return "No data found".
5. NEVER append warning messages. Just give the direct answer.
6. Once you have fetched data using the 'get_from_db' tool, synthesize a clear, concise answer. Do NOT output the raw SQL query in your final answer.
7. If the user's input is a greeting or unrelated to the schema, output exactly: NOT_A_QUERY
8. If the column contains ISO 8601 strings (e.g., '2015-06-01T...'), you MUST wrap the column name in STR_TO_DATE(column_name, '%Y-%m-%dT%H:%i:%s.%fZ') before applying date functions like MONTH(), YEAR(), or DAY().

PRIVACY & ACCESS CONTROL:
The current active user role is: ${role.toUpperCase()}
If the user role is "USER", they are strictly PROHIBITED from viewing personal details (names, emails, addresses). Reply: "You need to be an admin to access this data."
If the user role is "ADMIN", they are fully authorized to see all personal details.

Schema:
${schemaStr}`),
      new HumanMessage(question),
    ],
  }, { recursionLimit: 40 });

  const messages = response.messages;
  let sql_query = null;
  let results = null;

  for (const msg of messages) {
    if (msg instanceof AIMessage && msg.tool_calls && msg.tool_calls.length > 0) {
      const tc = msg.tool_calls.find((t: any) => t.name === "get_from_db");
      if (tc) sql_query = tc.args.sql;
    }
    if (msg.getType() === "tool") {
      try {
        const parsed = JSON.parse(msg.content as string);
        if (Array.isArray(parsed) && parsed.length > 0) {
          results = parsed;
        } else if (!results) {
          results = parsed;
        }
      } catch (e) { /* ignore */ }
    }
  }

  return {
    sql_query,
    results,
    answer: messages[messages.length - 1].content,
  };
}

// ─── Main POST handler ──────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const { question, role, provider } = await req.json();

    seed();

    const schemaStr = await getSchema();

    let result;
    if (provider === "local") {
      result = await handleLocalAI(question, role, schemaStr);
    } else {
      result = await handleOnlineAI(question, role, schemaStr);
    }

    return NextResponse.json(result, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });

  } catch (error: any) {
    console.error("❌ Error in /api/query:", error);
    return NextResponse.json({ detail: error.message }, {
      status: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }
}
