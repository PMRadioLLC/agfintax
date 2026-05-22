# AG FinTax — Landing Page

Static landing page (`/site`) + tiny Node API (`/server`) that captures form leads and pageviews to **Firebase Firestore**. Designed for StackAdapt-driven paid traffic with full attribution + real client IPs.

## What's tracked

Every visit and every form submission is written to Firestore with:

- **Real client IP** (captured server-side from `X-Forwarded-For` so it can't be spoofed by the browser)
- **User agent + referrer**
- **UTM params** — `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`
- **StackAdapt click ID** — captured from `sa_click_id` / `stackadapt_click_id` / `sa_cid` query params if present
- **Landing page** the visitor first hit (sticky across the session via `sessionStorage`)

## Project layout

```
/site/                  static landing page (deployed as Render Static Site)
  index.html            the page
  app.js                UTM capture, form submit, pageview ping
  assets/hero.jpg       hero image
/server/                Node/Express API (deployed as Render Web Service)
  index.js              POST /api/lead + POST /api/track + GET /health
  package.json
  .env.example
/firestore/
  collections.md        documents the shape of leads + pageviews
/render.yaml            Render Blueprint (creates both services)
```

## Setup — step by step

### 1. Create the Firebase project

1. Go to https://console.firebase.google.com → **Add project** → name it `agfintax` (or whatever). Skip Google Analytics if it asks — you don't need it for this.
2. After the project is created, in the left sidebar open **Build → Firestore Database** → **Create database**:
   - **Mode:** start in **production mode** (we'll lock it down further in step 4)
   - **Location:** pick the region closest to your users. `nam5 (us-central)` is a good default for US-targeted StackAdapt traffic.
3. The collections (`leads`, `pageviews`) don't need to be created manually — Firestore auto-creates them on the first write. See [`firestore/collections.md`](firestore/collections.md) for the document shape.

### 2. Generate a service account key

The API writes to Firestore using the Firebase **Admin SDK**, which needs a service account.

1. Firebase Console → ⚙ icon (top left) → **Project settings**
2. Tab → **Service accounts**
3. Make sure **Node.js** is selected
4. Click **Generate new private key** → a JSON file downloads. **Keep this file safe** — it's the equivalent of a master password to your Firestore data.
5. Open the JSON. You need three values from it for the API env vars:
   - `project_id` → `FIREBASE_PROJECT_ID`
   - `client_email` → `FIREBASE_CLIENT_EMAIL`
   - `private_key` → `FIREBASE_PRIVATE_KEY` (long multi-line string starting with `-----BEGIN PRIVATE KEY-----`)

### 3. Deploy to Render

1. Push this repo to GitHub (already done at https://github.com/sankalp047/agfintax).
2. On https://render.com → **New +** → **Blueprint** → connect your repo. Render reads `render.yaml` and creates two services:
   - `agfintax-site` — static landing page
   - `agfintax-api` — Node API
3. On `agfintax-api`, open **Environment** → **Add Environment Variable** for each of:
   - `FIREBASE_PROJECT_ID` — the `project_id` value
   - `FIREBASE_CLIENT_EMAIL` — the `client_email` value
   - `FIREBASE_PRIVATE_KEY` — the `private_key` value, **pasted exactly as it appears in the JSON** (with literal `\n` sequences inside the string). The server replaces `\n` with newlines at startup.
   - `ALLOWED_ORIGIN` — comma-separated list of every domain the site will be served from, e.g. `https://agfintax.com,https://www.agfintax.com,https://agfintax-site.onrender.com`
4. Save and let the service redeploy. Visit `https://agfintax-api.onrender.com/health` — it should return `{"ok":true}`.
5. Copy the API service's public URL. Open [`render.yaml`](render.yaml) and replace the `destination:` line under the `/api/*` rewrite with that URL. Commit + push — the static site redeploys and now proxies `/api/*` to the API.

### 4. Lock down Firestore rules

The API uses the Admin SDK (bypasses rules entirely), so we can — and should — block all browser access.

1. Firebase Console → **Firestore Database** → **Rules** tab
2. Replace whatever's there with:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if false;
       }
     }
   }
   ```
3. **Publish.**

This means even if someone guesses your collection names, they can't read your leads. Only your API can.

### 5. Add the custom domain

1. On Render, open `agfintax-site` → **Settings → Custom Domains** → add your domain (e.g. `agfintax.com` and `www.agfintax.com`).
2. Follow Render's instructions to add the CNAME/ANAME records at your DNS provider.
3. Once verified, add the domain to `ALLOWED_ORIGIN` on the API service if it wasn't already there.

### 6. Wire the StackAdapt conversion pixel

Two places:

- **Base site-wide pixel** — already installed in [`site/index.html`](site/index.html) (`saq('ts', 'Y1kc0SZIajJ0e7K0jtwhpw')`).
- **Conversion event** — open [`site/app.js`](site/app.js), find `STACKADAPT_CONVERSION_ID`, replace `REPLACE_WITH_CONVERSION_PIXEL_ID` with your conversion pixel ID from the StackAdapt dashboard (**Tracking → Conversions**). Fires automatically on successful form submit.

When you send StackAdapt traffic to the site, append UTM params and/or a click-ID param to the destination URL, e.g.:

```
https://agfintax.com/?utm_source=stackadapt&utm_medium=display&utm_campaign=q2-2026&sa_click_id={click_id_macro}
```

### 7. Confirm trust signals before launch

Two blocks in `site/index.html` are marked `TODO`:

- `TODO(stats)` — the `$240M+ saved / 50 states / 20+ yrs` numbers in the hero
- `TODO(press)` — the `Forbes / Inc. / Accounting Today / U.S. News` press strip

Replace these with real, defensible numbers and outlets before driving paid traffic.

## Local development

```bash
# Terminal 1 — API
cd server
cp .env.example .env   # fill in the three FIREBASE_* values
npm install
npm run dev            # listens on :8080

# Terminal 2 — site (any static server works)
cd site
python3 -m http.server 5173

# Open http://localhost:5173 — by default app.js hits same-origin /api/*.
# For local dev, edit window.AGFT_CONFIG.apiBase in index.html to
# "http://localhost:8080" so fetches reach your API.
```

## Viewing leads + pageviews

### Option A — Firebase Console (easiest)

1. Firebase Console → **Firestore Database** → **Data** tab
2. Click into `leads` or `pageviews`
3. Use the **filter** controls at the top to narrow by field (e.g. `utm_source == stackadapt`)
4. Click any document to see all fields

### Option B — Programmatic queries

If you want code-driven dashboards or exports, query Firestore from a Node script using the Admin SDK. Examples:

```js
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(require("./service-account.json")) });
const db = admin.firestore();

// All StackAdapt leads, newest first, last 30 days
const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
const snap = await db.collection("leads")
  .where("utm_source", "==", "stackadapt")
  .where("created_at", ">=", since)
  .orderBy("created_at", "desc")
  .get();
snap.forEach(d => console.log(d.id, d.data()));

// Unique visitors today
const today = new Date(); today.setHours(0,0,0,0);
const pvs = await db.collection("pageviews")
  .where("created_at", ">=", today)
  .get();
const ips = new Set();
pvs.forEach(d => { const ip = d.data().ip_address; if (ip) ips.add(ip); });
console.log("unique visitors today:", ips.size);
```

The first time you run a query that combines `where` + `where` + `orderBy`, Firestore will throw an error containing a one-click link to create the required composite index. Click it, wait ~30 seconds, re-run.

## What lives where in Firestore

- **`leads`** — one document per form submission. Includes name, email, phone, interest, optional message, IP, user agent, full attribution.
- **`pageviews`** — one document per landing page visit. Includes IP, user agent, referrer, UTM, click ID, path.

Full schema: [`firestore/collections.md`](firestore/collections.md).
