# scskiller.com

The SCSKiller website. Plain HTML, CSS and JS: no build step, no dependencies, no external requests.

| Path | Page |
|---|---|
| `index.html` | home |
| `support/` | Patreon tiers (linked from the app's welcome dialog as `/support`) |
| `privacy/` | privacy policy |
| `legal/` | aviso legal / legal notice, licence, trademarks |
| `code-signing-policy/` | code signing policy |
| `404.html` | not found |
| `assets/bg.js` | the animated frame-time background (WebGL2, Canvas 2D fallback) |

The header and footer are repeated in each page. Edit them everywhere.

## Preview

```
python -m http.server 8000
```

Open http://localhost:8000. Paths are absolute (`/assets/...`), so serve from the repo root.

## Publish on GitHub Pages

1. Create the repository and push `main`.
2. Settings → Pages → Build and deployment: "Deploy from a branch", `main`, `/ (root)`.
3. Custom domain: `scskiller.com` (already in `CNAME`). DNS: the apex A/AAAA records for GitHub Pages and a `www` CNAME.
   Verify the domain for the account (Settings → Pages → verified domains) before pointing DNS at it.
4. Tick "Enforce HTTPS" once the certificate is issued.

`.nojekyll` makes Pages serve the files as they are.

## Downloads

The download section has one block per OS (`.dl-os[data-os]`), each linking the unversioned asset of the public repo's
latest release. `assets/site.js` moves the visitor's OS first and points the `[data-dl]` buttons at it.
