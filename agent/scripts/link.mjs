// Print the app link and the viewer link for one session (#64):
//   npm run link -- <session>
// Reads BEAVER_AGENT_TOKEN from the repo's .env. Anyone holding the app link can ask questions in
// that session; the viewer link only watches it.
import { readFileSync } from "node:fs";
import { sessionKey, viewerKey } from "../src/auth.ts";

const session = process.argv[2];
if (!session || !/^[\w-]{1,64}$/.test(session)) {
  console.error("Usage: npm run link -- <session>, with letters, digits, - or _ (up to 64)");
  process.exit(1);
}
const env = readFileSync(new URL("../../.env", import.meta.url), "utf8");
const token = env.match(/^BEAVER_AGENT_TOKEN=(.+)$/m)?.[1]?.trim();
if (!token) {
  console.error("BEAVER_AGENT_TOKEN is missing from .env");
  process.exit(1);
}
const base = process.env.BEAVER_AGENT_URL ?? "https://beaver-agent.shereenlee-ds.workers.dev";
const query = (key) => `s=${encodeURIComponent(session)}&key=${key}`;
console.log(`App:    ${base}/?${query(await sessionKey(token, session))}`);
console.log(`Viewer: ${base}/session.html?${query(await viewerKey(token, session))}`);
