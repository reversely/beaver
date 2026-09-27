# Deployment

## Public site

The public site is https://beaver.shereenlee-ds.workers.dev/, served by the Cloudflare Worker
`beaver` from this repo's `main` branch. The domain `beaver.select` is registered at Porkbun and
becomes the site's address once its nameservers point to Cloudflare.

| Item | Value |
|---|---|
| Published folder | `web/`, named once in `wrangler.jsonc` (`assets.directory`) |
| Paths | Every file under `web/` is served at the same path: `web/index.html` at `/`, `web/art/land.webp` at `/art/land.webp` |
| Not published | Everything outside `web/`; the desktop app at `/app/` exists only on the laptop |
| Trigger | Every push to `main` |
| Deploy time | About 5 to 7 minutes from push to live |

The Worker's build settings in the Cloudflare dashboard (Workers & Pages, `beaver`, Settings,
Build):

| Setting | Value |
|---|---|
| Git repository | `reversely/beaver`, branch `main` |
| Build command | empty |
| Deploy command | `npx wrangler deploy` |
| Root directory | empty |
| Build watch paths | none |

To publish a different folder, change `assets.directory` in `wrangler.jsonc`. No dashboard setting
names a folder.

## Desktop app

The desktop app runs on the laptop at `http://127.0.0.1:8765`, serving `web/` at `/` and the app
at `/app/`. A named Cloudflare Tunnel with Cloudflare Access will put it on a `beaver.select`
subdomain (#36); that waits on the same nameserver move.
