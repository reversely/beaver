// Copy the desktop app's interface into the Worker's static files (#65), so one copy of it serves
// the laptop and the Cloudflare page. Wrangler runs this before every deploy and dev run
// (wrangler.jsonc "build"); the copies are gitignored.
//   src/beaver/desktop/ui/  ->  agent/public/app/
//   web/nav.css, web/nav.js ->  agent/public/  (the site menu the interface loads from /)
import { cpSync, mkdirSync, rmSync } from "node:fs";

const repo = new URL("../../", import.meta.url);
const out = new URL("public/", new URL("../", import.meta.url));
const app = new URL("app/", out);

// Keep the bundled voice client, which build:client writes into app/.
rmSync(app, { recursive: true, force: true });
mkdirSync(app, { recursive: true });
cpSync(new URL("src/beaver/desktop/ui/", repo), app, {
  recursive: true,
  filter: (source) => !source.includes("__pycache__"),
});
for (const file of ["nav.css", "nav.js"]) cpSync(new URL(`web/${file}`, repo), new URL(file, out));
console.log("Copied the interface into agent/public/app/");
