# AG FinTax — Landing Page

Static landing page (`/site`) + tiny Node API (`/server`) that captures form leads and pageviews to Supabase. Designed for StackAdapt-driven paid traffic with full attribution + real client IPs.

## What's tracked

Every visit and every form submission is written to Supabase with:

- **Real client IP** (captured server-side from `X-Forwarded-For` so it can't be spoofed by the browser)
- **User agent + referrer**
- **UTM params** — `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`
- **StackAdapt click ID** — captured from `sa_click_id` / `stackadapt_click_id` / `sa_cid` query params if present
- **Landing page** the visitor first hit (sticky across the session via `sessionStorage`)

## Project layout

```
/site/              static landing page (deployed as Render Static Site)
  index.html        the page
  app.js            UTM capture, form submit, pageview ping
  assets/hero.jpg   hero image
/server/            Node/Express API (deployed as Render Web Service)
  index.js          POST /api/lead + POST /api/track + GET /health
  package.json
  .env.example
/supabase/
  schema.sql        run this once in the Supabase SQL editor
/render.yaml        Render Blueprint (creates both services)
```

## Setup — step by step

### 1. Create the Supabase project

1. Go to https://supabase.com → **New project**. Pick a region close to your users (US-East is fine).
2. Once created, open **SQL Editor** → **New query** → paste the contents of [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
3. Open **Project Settings → API** and copy two values:
   - **Project URL** (e.g. `https://abcdxyz.supabase.co`) → `SUPABASE_URL`
   - **`service_role` secret** (under "Project API keys") → `SUPABASE_SERVICE_ROLE_KEY`
   - ⚠️ The `service_role` key bypasses Row Level Security. Keep it server-side only. **Never** put it in `site/` or commit it.

### 2. Deploy to Render

1. Push this repo to GitHub.
2. On https://render.com → **New +** → **Blueprint** → connect your repo. Render reads `render.yaml` and creates two services:
   - `agfintax-site` — static landing page
   - `agfintax-api` — Node API
3. On `agfintax-api`, open **Environment** and set:
   - `SUPABASE_URL` — from step 1
   - `SUPABASE_SERVICE_ROLE_KEY` — from step 1
   - `ALLOWED_ORIGIN` — comma-separated list of every domain the site will be served from, e.g. `https://agfintax.com,https://www.agfintax.com,https://agfintax-site.onrender.com`
4. Once the API service deploys, copy its public URL (e.g. `https://agfintax-api.onrender.com`). Open [`render.yaml`](render.yaml) and replace the `destination:` line under the `/api/*` rewrite with that URL. Commit + push — the static site redeploys and now proxies `/api/*` to the API.

### 3. Add the custom domain

1. On Render, open `agfintax-site` → **Settings → Custom Domains** → add your domain (e.g. `agfintax.com` and `www.agfintax.com`).
2. Follow Render's instructions to add the CNAME/ANAME records at your DNS provider.
3. Once the domain is verified, add it to `ALLOWED_ORIGIN` on the API service if it wasn't already there.

### 4. Wire the StackAdapt conversion pixel

There are two places to paste StackAdapt code:

- **Base site-wide pixel** — paste the snippet StackAdapt gives you in [`site/index.html`](site/index.html), where you'll find:
  ```html
  <!-- TODO(stackadapt): paste base pixel snippet here -->
  ```
- **Conversion event** — paste the conversion snippet inside `window.saConversion` in [`site/app.js`](site/app.js). It fires automatically after a successful form submit:
  ```js
  window.saConversion = function () {
    // TODO(stackadapt): fire conversion event here.
  };
  ```

When you send StackAdapt traffic to the site, append UTM params and/or a click-ID param to the destination URL, e.g.:

```
https://agfintax.com/?utm_source=stackadapt&utm_medium=display&utm_campaign=q2-2026&sa_click_id={click_id_macro}
```

`app.js` reads these on landing, persists them in `sessionStorage`, and attaches them to both the pageview ping and the lead row.

### 5. (Optional) Confirm trust signals before launch

Two blocks in `site/index.html` are marked `TODO`:

- `TODO(stats)` — the `$240M+ saved / 50 states / 20+ yrs` numbers in the hero
- `TODO(press)` — the `Forbes / Inc. / Accounting Today / U.S. News` press strip

Replace these with real, defensible numbers and outlets before driving paid traffic. Don't ship fake trust signals.

## Local development

```bash
# Terminal 1 — API
cd server
cp .env.example .env   # fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev            # listens on :8080

# Terminal 2 — site (any static server works)
cd site
python3 -m http.server 5173

# Open http://localhost:5173 — by default app.js hits same-origin /api/*.
# For local dev, edit window.AGFT_CONFIG.apiBase in index.html to
# "http://localhost:8080" so fetches reach your API.
```

## What lives where in Supabase

- **`leads`** — one row per form submission. Includes name, email, phone, interest, optional message, IP, user agent, full attribution.
- **`pageviews`** — one row per landing page visit. Includes IP, user agent, referrer, UTM, click ID, path.

Both tables have RLS enabled with **no public policies** — only the service-role key (used by the API) can read or write. If you want to view leads in Supabase Studio, log in with a user who has the appropriate role, or query via the SQL editor.

## Useful queries

```sql
-- Leads from StackAdapt, newest first
select created_at, first_name, last_name, email, phone, interest,
       utm_campaign, utm_content, sa_click_id, ip_address
from leads
where utm_source = 'stackadapt'
order by created_at desc;

-- Unique visitors per day from StackAdapt
select date_trunc('day', created_at) as day,
       count(distinct ip_address) as unique_ips,
       count(*) as pageviews
from pageviews
where utm_source = 'stackadapt'
group by 1
order by 1 desc;

-- Conversion rate by campaign
with v as (
  select utm_campaign, count(distinct ip_address) as visitors
  from pageviews where utm_source = 'stackadapt' group by 1
),
l as (
  select utm_campaign, count(*) as leads
  from leads where utm_source = 'stackadapt' group by 1
)
select v.utm_campaign, v.visitors, coalesce(l.leads, 0) as leads,
       round(100.0 * coalesce(l.leads, 0) / nullif(v.visitors, 0), 2) as cvr_pct
from v left join l using (utm_campaign)
order by visitors desc;
```
