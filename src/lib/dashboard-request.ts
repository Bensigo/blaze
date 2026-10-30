/** Browser-only durable receipt key. Failure to persist never triggers a retry. */
export function dashboardRequestId(key: string, fallback: { current: string | null }) {
  if (fallback.current) return fallback.current;
  try {
    const saved = sessionStorage.getItem(key);
    if (saved && /^[0-9a-f-]{36}$/i.test(saved)) return fallback.current = saved;
  } catch { /* Private browser storage may be unavailable. */ }
  const id = crypto.randomUUID(); fallback.current = id;
  try { sessionStorage.setItem(key, id); } catch { /* The in-memory receipt still protects this submission. */ }
  return id;
}
export function clearDashboardRequest(key: string) {
  try { sessionStorage.removeItem(key); } catch { /* No automatic replay. */ }
}
