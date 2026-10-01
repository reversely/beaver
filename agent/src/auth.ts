// The laptop proves itself with the shared token from its .env; the Worker holds the same value
// as the secret BEAVER_AGENT_TOKEN.

const encoder = new TextEncoder();

/** Compare two strings in time that depends only on their lengths. */
export function sameText(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

/** True when the request carries `Authorization: Bearer <token>`. */
export function hasToken(request: Request, token: string | undefined): boolean {
  if (!token) return false;
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") && sameText(header.slice(7), token);
}

/** The key a viewer link carries for one session: HMAC-SHA256 of the session name under the
 * shared token, as 32 hex characters. It opens read-only connections to that session only, and
 * the laptop derives the same key (cloudflare.viewer_key). */
export async function viewerKey(token: string, session: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(token),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(session)));
  return Array.from(signature, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
