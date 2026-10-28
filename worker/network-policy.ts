import type { BrowserContext, Page } from "playwright";
import { normalizeNetworkPolicy, resolvePublicHost, type NetworkPolicy, type Resolver } from "../src/lib/network-policy";

type SafeGame = { url: string; host: string; ip: string; local: boolean };
export type BrowserPolicy = {
  resources: Set<string>;
  sockets: Set<string>;
  pins: Map<string, string>;
  fixture: boolean;
  frameUrls?: Set<string>;
};

export async function prepareBrowserPolicy(safe: SafeGame, input: unknown, fixture: boolean, resolver?: Resolver): Promise<BrowserPolicy> {
  const policy: NetworkPolicy = normalizeNetworkPolicy(input);
  // Controlled fixture never gains additional destinations, including via a saved policy.
  const resources = new Set([new URL(safe.url).origin, ...(fixture ? [] : policy.resourceOrigins)]);
  const sockets = new Set(fixture ? [] : policy.webSocketOrigins);
  const frameUrls = new Set(fixture ? [] : policy.frameUrls || []);
  if ([...frameUrls].some(url => new URL(url).origin !== new URL(safe.url).origin)) throw new Error("Reviewed frames must share the game origin");
  const pins = new Map<string, string>([[safe.host, safe.ip]]);
  for (const value of [...resources, ...sockets]) {
    const host = new URL(value).hostname;
    if (!pins.has(host)) pins.set(host, await resolvePublicHost(host, resolver));
  }
  return { resources, sockets, pins, fixture, frameUrls };
}

export function resolverRules(policy: BrowserPolicy): string {
  // Catch-all fails DNS for every hostname not explicitly pinned, including on redirects.
  return [...policy.pins].map(([host, ip]) => `MAP ${host} ${ip}`).concat("MAP * ~NOTFOUND").join(", ");
}

function isAppTelemetry(u: URL, appOrigin?: string): boolean {
  if (!appOrigin) return false;
  const comparable = new URL(u.href);
  if (comparable.protocol === "wss:") comparable.protocol = "https:";
  else if (comparable.protocol === "ws:") comparable.protocol = "http:";
  if (comparable.origin !== appOrigin) return false;
  let pathname = comparable.pathname;
  for (let i = 0; i < 4 && pathname.includes("%"); i++) {
    const decoded = decodeURIComponent(pathname);
    if (decoded === pathname) break;
    pathname = decoded;
  }
  const segments: string[] = [];
  for (const segment of pathname.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop(); else segments.push(segment);
  }
  pathname = `/${segments.join("/")}`;
  return pathname === "/api/collect" || pathname === "/api/capture" || pathname.startsWith("/api/capture/");
}

function allowedResource(raw: string, policy: BrowserPolicy, appOrigin?: string): boolean {
  try {
    const u = new URL(raw);
    if (u.username || u.password || !policy.resources.has(u.origin) || isAppTelemetry(u, appOrigin)) return false;
    if (policy.fixture && !u.pathname.startsWith("/fixture/") && u.pathname !== "/sdk.js") return false;
    return true;
  } catch { return false; }
}

/** Mark this worker-controlled context before creating any pages. */
export async function installAgentMarker(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    Object.defineProperty(globalThis, "__WEB_GAME_STUDIO_AGENT__", { value: true, writable: false, configurable: false, enumerable: false });
  });
}

/** Set before any navigation. Popup and frame navigations are rejected fail-closed. */
export async function installBrowserPolicy(context: BrowserContext, page: Page, policy: BrowserPolicy, blocked: () => void, appOrigin?: string, initial?: { url: string; capability: string }): Promise<void> {
  // Defense in depth only: the container firewall is the network boundary.
  await context.addInitScript(() => {
    for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection", "WebTransport"]) {
      try { Object.defineProperty(globalThis, name, { value: undefined, configurable: false, writable: false }); } catch { /* unavailable */ }
    }
  });
  // Playwright's route callback does not run on redirect hops; CDP Fetch does.
  const cdp = await context.newCDPSession(page);
  const mainFrameId = (await cdp.send("Page.getFrameTree")).frameTree.frame.id;
  const mainOrigin = new URL(initial?.url || [...policy.resources][0]).origin;
  const csp = `connect-src ${[...policy.resources, ...policy.sockets].join(" ") || "'none'"}; worker-src 'none'; frame-src ${[...(policy.frameUrls || [])].join(" ") || "'none'"}; object-src 'none'`;
  let initialSent = false;
  cdp.on("Fetch.requestPaused", ({ requestId, request, frameId, resourceType, responseStatusCode, responseHeaders }) => {
    if (responseStatusCode !== undefined) {
      if (resourceType === "Document" && frameId !== mainFrameId && responseStatusCode >= 300 && responseStatusCode < 400) {
        blocked(); void cdp.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }).catch(() => {}); return;
      }
      // Enforce before scripts execute. WebSocket routing does not cover worker globals.
      if (resourceType === "Document" && responseStatusCode >= 200 && responseStatusCode < 300) {
        void (async () => {
          try {
            const data = await cdp.send("Fetch.getResponseBody", { requestId });
            if (data.body.length > 8 * 1024 * 1024) throw new Error("Document too large");
            const headers = (responseHeaders || []).filter(h => !["content-length", "content-encoding", "transfer-encoding"].includes(h.name.toLowerCase()));
            await cdp.send("Fetch.fulfillRequest", { requestId, responseCode: responseStatusCode,
              responseHeaders: [...headers, { name: "Content-Security-Policy", value: frameId === mainFrameId ? csp : "sandbox allow-scripts allow-pointer-lock allow-orientation-lock; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'" }],
              body: data.base64Encoded ? data.body : Buffer.from(data.body).toString("base64") });
          } catch { await cdp.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }).catch(() => {}); }
        })();
      } else void cdp.send("Fetch.continueResponse", { requestId }).catch(() => {});
      return;
    }
    const permitted = allowedResource(request.url, policy, appOrigin) && (resourceType !== "Document" || (frameId === mainFrameId ? new URL(request.url).origin === mainOrigin : !!policy.frameUrls?.has(request.url)));
    if (!permitted) blocked();
    const requestHeaders = Object.entries(request.headers).filter(([name]) => name.toLowerCase() !== "x-blaze-synthetic-capability").map(([name, value]) => ({ name, value: String(value) }));
    if (permitted && !initialSent && initial && resourceType === "Document" && frameId === mainFrameId && request.method === "GET" && request.url === initial.url) {
      initialSent = true; requestHeaders.push({ name: "x-blaze-synthetic-capability", value: initial.capability });
    }
    void cdp.send(permitted ? "Fetch.continueRequest" : "Fetch.failRequest", permitted
      ? { requestId, headers: requestHeaders }
      : { requestId, errorReason: "BlockedByClient" }).catch(() => {});
  });
  await cdp.send("Fetch.enable", { patterns: [
    { urlPattern: "*", requestStage: "Request" },
    { urlPattern: "*", resourceType: "Document", requestStage: "Response" },
  ] });
  await context.route("**/*", async (route) => {
    try {
      const request = route.request();
      const frame = request.frame();
      // Prevent popup first navigation and cross-process frame targets, which lack this CDP session.
      if (frame.page() !== page || (request.isNavigationRequest() && (frame === page.mainFrame() ? new URL(request.url()).origin !== mainOrigin : (frame.parentFrame() !== page.mainFrame() || !policy.frameUrls?.has(request.url())))) || !allowedResource(request.url(), policy, appOrigin)) {
        blocked();
        await route.abort();
      } else await route.continue();
    } catch { blocked(); await route.abort().catch(() => {}); }
  });
  await context.routeWebSocket("**/*", (socket) => {
    try {
      const u = new URL(socket.url());
      if (u.username || u.password || !policy.sockets.has(u.origin) || isAppTelemetry(u, appOrigin)) {
        blocked();
        void socket.close();
      } else socket.connectToServer();
    } catch { blocked(); void socket.close(); }
  });
}
