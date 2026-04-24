// ── RBAC: Role-Based Access Control — Admin SQL Panel ───────────
// Standard users only see AI response + data table.
// Admins additionally see: raw SQL, prompt used, server logs.

{/* Right Column: SQL Query Panel — ADMINS ONLY */}
{(currentSql && userRole.toLowerCase() === 'admin') && (
  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80">

    {/* Header */}
    <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
      <h3 className="text-sm font-semibold text-zinc-100">Query Used</h3>
      <button onClick={handleCopy} className="copy-btn">
        {copied ? <Check /> : <Copy />} Copy
      </button>
    </div>

    {/* Syntax-highlighted SQL */}
    <div className="p-6 bg-[#0d0d0f] min-h-[200px]">
      <pre className="font-mono text-[13px] leading-relaxed">
        <code className="text-[#a5b4fc]">{currentSql}</code>
      </pre>
    </div>

    {/* Server Execution Logs — Admin-only */}
    {serverLogs && serverLogs.length > 0 && (
      <div className="p-4 bg-[#0d0d0f] max-h-[300px] overflow-auto">
        <pre className="font-mono text-xs">
          {serverLogs.map((log, i) => (
            <div key={i}>
              <span className="text-zinc-600">[{new Date().toLocaleTimeString()}]</span>
              <span className={
                log.includes('✅') ? 'text-emerald-400' :
                log.includes('❌') ? 'text-rose-400' : 'text-zinc-300'
              }>{log}</span>
            </div>
          ))}
        </pre>
      </div>
    )}
  </div>
)}
