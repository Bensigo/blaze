// Test-only process fixture: exercise stdio without opening a network listener.
globalThis.fetch = async (url, options) => new Response(JSON.stringify({ url: String(url), method: options?.method || "GET", authorization: options?.headers?.Authorization, redirect: options?.redirect }), { status: 200, headers: { "Content-Type": "application/json" } });
