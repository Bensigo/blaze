// PostgreSQL JSONB can reorder nested object keys. Approval identities must depend
// on values, never the serializer's property insertion order.
export const approvalJson = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
    : item) || "null";
