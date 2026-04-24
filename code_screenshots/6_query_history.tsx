// ── Query History: localStorage Persistence ──────────────────────
// Saves each query with its result, AI provider, and timestamp.
// Clicking a history item fully restores that session's state.

const [history, setHistory] = useState<HistoryItem[]>(() => {
  const saved = localStorage.getItem('query-history');
  return saved ? JSON.parse(saved) : [];
});

const handleConvert = async (
  query: string, provider: 'local' | 'online', database: string
) => {
  setIsLoading(true);
  const res  = await fetch('http://localhost:3000/api/query', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ question: query, role: userRole, provider, database }),
  });
  const data = await res.json();

  // Persist to history with full context for instant restoration
  const newItem: HistoryItem = {
    id:         crypto.randomUUID(),
    query,
    sql:        data.sql_query,
    timestamp:  Date.now(),
    provider,
    aiResponse: data.answer,
    results:    data.results,
  };

  const updated = [newItem, ...history].slice(0, 50); // keep last 50
  setHistory(updated);
  localStorage.setItem('query-history', JSON.stringify(updated));
  setIsLoading(false);
};

// Restore a previous query from sidebar click
const handleSelectHistory = (item: HistoryItem) => {
  setCurrentQuery(item.query);
  setCurrentSql(item.sql     ?? '');
  setQueryResult(item.results ?? null);
  setAiResponse(item.aiResponse ?? '');
  setSelectedHistoryId(item.id);
};
