// ── Main POST Handler: /api/query ───────────────────────────────
// Enforces read-only DB access, injects schema context,
// routes between Local AI and Online AI, and returns logs

export const maxDuration = 60; // Vercel function timeout

export async function POST(req: Request) {
  try {
    const { question, role, provider, database } = await req.json();

    // Collect execution logs to surface in the admin UI
    const serverLogs: string[] = [];
    const addLog = (msg: string) => serverLogs.push(msg);

    // 1. Verify DB connectivity (read-only — no writes allowed)
    await seed(database, addLog);

    // 2. Fetch relationship-aware schema → inject into LLM context
    const schemaStr = await getSchema(database, addLog);

    // 3. Route to the correct AI provider
    let result;
    if (provider === "local") {
      result = await handleLocalAI(question, role, schemaStr, database, addLog);
    } else {
      result = await handleOnlineAI(question, role, schemaStr, database, addLog);
    }

    // 4. Attach server logs to payload (visible to admins only in UI)
    result.logs = serverLogs;

    return NextResponse.json(result, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });

  } catch (error: any) {
    console.error("❌ Error in /api/query:", error);
    return NextResponse.json(
      { detail: error.message },
      { status: 500 }
    );
  }
}
