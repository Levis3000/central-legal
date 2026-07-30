# Central Legal

One repo + one Railway service for every app’s **Privacy Policy**, **Terms**, and **Contact** forms.
Each app still gets its **own URLs**. Support inbox addresses are **never shown** on public pages.

## Per-app links (same Railway deploy)

Replace `YOUR-APP.up.railway.app` with your Railway domain:

| App | Privacy | Terms | Contact |
| --- | --- | --- | --- |
| **SnapTract** | `/snaptract/privacy` | `/snaptract/terms` | `/snaptract/contact` |
| **Falaah** | `/falaah/privacy` | `/falaah/terms` | — |
| **Towly** | `/towly/privacy` | `/towly/terms` | `/towly/contact` |
| **Guide Sight** | `/guide-sight/privacy` | `/guide-sight/terms` | `/guide-sight/contact` |

Falaah EULA: `/falaah/eula` · Towly EULA: `/towly/eula` · SnapTract EULA: `/snaptract/eula`

## Contact forms (SMTP)

All contact forms `POST /api/contact`. The server emails your inbox via SMTP.
**Subjects are always prefixed with the app name**, e.g. `[Guide Sight] Privacy Request`.

Set these in Railway → Variables (see also `.env.example`):

| Variable | Notes |
| --- | --- |
| `SMTP_HOST` | e.g. `smtp.gmail.com` |
| `SMTP_PORT` | e.g. `587` (or `465`) |
| `SMTP_SECURE` | `true` for 465, otherwise omit/`false` |
| `SMTP_USER` | SMTP login |
| `SMTP_PASS` | SMTP password / app password |
| `SMTP_FROM` | Optional From override (defaults to `SMTP_USER`) |
| `CONTACT_TO_EMAIL` | Destination inbox (kept server-side only) |

Do **not** commit real credentials or the destination address.

SnapTract JSON (for the iOS app):

- `/snaptract-privacy-policy.json`, `/snaptract-terms-of-service.json`
- Short aliases: `/snaptract/privacy.json`, `/snaptract/terms.json`

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
3. Add the SMTP / `CONTACT_TO_EMAIL` variables above
4. **Settings → Networking → Generate Domain**
5. Use the per-app paths above in App Store Connect / in-app links

## Local

```bash
cp .env.example .env   # fill SMTP_* and CONTACT_TO_EMAIL
npm install
npm start              # http://localhost:3000/guide-sight/contact
```

## Files

| File | App |
| --- | --- |
| `falaah-*.html` | Falaah |
| `snaptract-*.html` / `snaptract-*.json` | SnapTract |
| `towly-*.html` | Towly |
| `guide-sight-*.html` | Guide Sight |
| `server.js` | Express + `/api/contact` SMTP |
