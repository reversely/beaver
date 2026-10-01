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
