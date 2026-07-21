# Central Legal

One repo + one Railway service for every app’s **Privacy Policy** and **Terms of Service**.
Each app still gets its **own URLs**.

## Per-app links (same Railway deploy)

Replace `YOUR-APP.up.railway.app` with your Railway domain:

| App | Privacy | Terms |
| --- | --- | --- |
| **SnapTract** | `https://YOUR-APP.up.railway.app/snaptract/privacy` | `https://YOUR-APP.up.railway.app/snaptract/terms` |
| **Falaah** | `https://YOUR-APP.up.railway.app/falaah/privacy` | `https://YOUR-APP.up.railway.app/falaah/terms` |

SnapTract JSON (for the iOS app) — product-prefixed filenames:

- `https://YOUR-APP.up.railway.app/snaptract-privacy-policy.json`
- `https://YOUR-APP.up.railway.app/snaptract-terms-of-service.json`

Also available as short aliases: `/snaptract/privacy.json`, `/snaptract/terms.json`

Contact (SnapTract only): `https://YOUR-APP.up.railway.app/snaptract-contact.html`

Optional combined Falaah page: `/falaah/both`

## Optional: custom domains on the same service

In Railway → your service → **Settings → Networking → Custom Domain**, you can attach
several domains to this **one** service, for example:

- `legal.snaptract.app` → still serves `/snaptract/...` (and everything else)
- `legal.mysalahtracker.com` → still serves `/falaah/...`

Same backend; different hostnames if you want cleaner App Store URLs.

## Deploy to Railway

1. Railway → **New Project → Deploy from GitHub** → `central-legal`
2. It runs `npm install` then `npm start` (uses `PORT` automatically)
3. **Settings → Networking → Generate Domain**
4. Use the per-app paths above in App Store Connect / in-app links

## Local

```bash
npm install
npm start   # http://localhost:3000/snaptract/privacy
```

## Files

| File | App |
| --- | --- |
| `falaah-privacy-policy.html` | Falaah |
| `falaah-terms-of-service.html` | Falaah |
| `falaah-privacy-and-terms.html` | Falaah (combined) |
| `snaptract-privacy-policy.html` | SnapTract |
| `snaptract-terms-of-service.html` | SnapTract |
| `snaptract-privacy-policy.json` / `snaptract-terms-of-service.json` | SnapTract (app) |
| `snaptract-contact.html` | SnapTract contact form |
