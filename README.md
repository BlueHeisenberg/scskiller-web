# scskiller.com

The SCSKiller website. Plain HTML, CSS and JS: no build step, no dependencies, no external requests.

| Path | Page |
|---|---|
| `index.html` | home |
| `support/` | Patreon tiers (linked from the app's welcome dialog as `/support`) |
| `privacy/` | privacy policy |
| `legal/` | aviso legal / legal notice, licence, trademarks |
| `code-signing-policy/` | SignPath code signing policy |
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

## Release flag

`RELEASED = false` in `assets/site.js` shows the "Coming soon" labels. Set it to `true` once the first release exists:
every Download button then opens the "Windows may warn you" notice, which downloads from `DOWNLOAD_URL` (the public
repo's latest release).
