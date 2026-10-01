// The beaver-agent Worker: one deployment that serves the Beaver page, the viewer page, the
// Whisper model files, and the BeaverGuide agent (guide.ts).
//   /app/              the desktop app's interface (copied from src/beaver/desktop/ui/ by
//                      `npm run build`), opened with ?s=<session>&key=<session key>
//   /                  a redirect to /app/ that keeps the query
//   /session.html      the read-only viewer page, opened with the viewer key
//   /models/<file>     Whisper base for the page's in-browser transcription, from R2
//   /agents/beaver-guide/<session>/...  the agent's actions and its WebSocket
// Static files come from public/ before this code runs; every other path lands here.

import { routeAgentRequest } from "agents";
import { hasToken, type Role, roleFor } from "./auth.ts";
import { type Env, json } from "./guide.ts";
import { modelKey } from "./models.ts";

export { BeaverGuide } from "./guide.ts";

/** The key a request carries for the session in its path: the header for HTTP, the query for a
 * WebSocket, since browsers cannot set headers on one. */
async function role(request: Request, env: Env): Promise<Role | null> {
  const url = new URL(request.url);
  const session = decodeURIComponent(url.pathname.split("/")[3] ?? "");
  const key = request.headers.get("X-Session-Key") ?? url.searchParams.get("key") ?? "";
  return roleFor(env.BEAVER_AGENT_TOKEN, session, key);
}

async function model(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const key = modelKey(new URL(request.url).pathname);
  if (!key) return json({ error: "Not found" }, 404);
  // A Worker's responses skip Cloudflare's cache unless it uses the Cache API; streaming 77 MB
  // from R2 on every first visit took about 45 s, so each file is kept at the edge after one read.
  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).toString(), { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  const object = await env.MODELS.get(key);
  if (!object) return json({ error: "Not found" }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Content-Length", String(object.size));
  // The files never change under one name, so browsers and Cloudflare's edge keep them.
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  const response = new Response(object.body, { headers });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    // Links minted before #65 opened the page at /.
    if (path === "/") return Response.redirect(`${url.origin}/app/${url.search}`, 302);
    if (path.startsWith("/models/")) {
      return request.method === "GET" ? model(request, env, ctx) : json({ error: "Use GET" }, 405);
    }
    if (!path.startsWith("/agents/")) return json({ error: "Not found" }, 404);
    const websocket = request.headers.get("Upgrade") === "websocket";
    const who = await role(request, env);
    // A WebSocket opens with either key; the agent lets only a member start a voice call. HTTP
    // actions take the laptop's token or a member's key.
    const allowed = websocket ? who !== null : hasToken(request, env.BEAVER_AGENT_TOKEN) || who === "member";
    if (!allowed) return json({ error: "Missing or wrong key" }, 401);
    return (await routeAgentRequest(request, env)) ?? json({ error: "Not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
