const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const PORT = process.env.PORT || 8080;
const FIREBASE_PROJECT_ID    = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_CLIENT_EMAIL  = process.env.FIREBASE_CLIENT_EMAIL;
const FIREBASE_PRIVATE_KEY   = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const ALLOWED_ORIGIN = (process.env.ALLOWED_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);

// Mailgun (optional — if unconfigured, server runs but no notifications fire)
const MAILGUN_API_KEY  = process.env.MAILGUN_API_KEY  || "";
const MAILGUN_DOMAIN   = process.env.MAILGUN_DOMAIN   || "";
const MAILGUN_API_BASE = process.env.MAILGUN_API_BASE || "https://api.mailgun.net/v3";
const LEAD_FROM        = process.env.LEAD_FROM        || "AG FinTax Leads <leads-agfintax@funasia.net>";
const LEAD_TO          = process.env.LEAD_TO          || "agfintax@funasia.net";

if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
  console.error("Missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY in env.");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId:   FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey:  FIREBASE_PRIVATE_KEY
  })
});

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const app = express();
app.set("trust proxy", true); // Render sits behind a proxy; needed for real client IP
app.use(express.json({ limit: "32kb" }));

app.use(cors({
  origin: function (origin, cb) {
    // No origin header → same-origin request, curl, or server-to-server. Allow.
    if (!origin) return cb(null, true);
    // No allowed list configured → permissive (logged at boot below).
    if (ALLOWED_ORIGIN.length === 0) return cb(null, true);
    // Exact match against the configured allow-list.
    if (ALLOWED_ORIGIN.includes(origin)) return cb(null, true);
    // Reject WITHOUT throwing — throwing makes Express return 500 on the
    // preflight, which masks the real cause. Returning false makes the
    // middleware send a clean rejection that the browser surfaces as a CORS
    // error, and we log the mismatch so it's debuggable from Render logs.
    console.warn("[cors] rejecting origin:", origin, "— configured ALLOWED_ORIGIN:", ALLOWED_ORIGIN);
    return cb(null, false);
  }
}));

console.log("[boot] ALLOWED_ORIGIN =", ALLOWED_ORIGIN.length ? ALLOWED_ORIGIN : "(empty — permissive mode)");

function clientIp(req) {
  const ip = req.ip || req.connection?.remoteAddress || null;
  if (!ip) return null;
  return ip.replace(/^::ffff:/, "");
}

function pickString(v, max = 2000) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function isEmail(v) {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

// Send a lead notification via Mailgun. Fire-and-forget — never throws.
// If MAILGUN_API_KEY or MAILGUN_DOMAIN is unset, this is a no-op.
async function notifyLead(lead) {
  if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
    console.warn("[lead] mailgun not configured (MAILGUN_API_KEY / MAILGUN_DOMAIN missing); skipping notification");
    return;
  }

  const subject = `New lead: ${lead.first_name} ${lead.last_name} (${lead.interest || "general"})`;

  const rows = [
    ["Name",                 `${lead.first_name} ${lead.last_name}`],
    ["Email",                lead.email],
    ["Phone",                lead.phone || "—"],
    ["Interest",             lead.interest || "—"],
    ["Message",              lead.message || "—"],
    ["IP address",           lead.ip_address || "—"],
    ["Referrer",             lead.referrer || "—"],
    ["Landing page",         lead.landing_page || "—"],
    ["UTM source",           lead.utm_source || "—"],
    ["UTM medium",           lead.utm_medium || "—"],
    ["UTM campaign",         lead.utm_campaign || "—"],
    ["UTM content",          lead.utm_content || "—"],
    ["UTM term",             lead.utm_term || "—"],
    ["StackAdapt click ID",  lead.sa_click_id || "—"],
    ["User agent",           lead.user_agent || "—"]
  ];

  const text = rows.map(function (r) { return r[0] + ": " + r[1]; }).join("\n");
  const html =
    '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:640px;">' +
    '<h2 style="font-family:Georgia,serif;font-weight:400;color:#0A1F44;margin:0 0 8px;">New lead on agfintax.com</h2>' +
    '<p style="color:#666;margin:0 0 24px;font-size:14px;">A visitor submitted the contact form. Details below.</p>' +
    '<table style="border-collapse:collapse;width:100%;font-size:14px;">' +
    rows.map(function (r) {
      return '<tr>' +
        '<td style="padding:6px 14px 6px 0;color:#888;vertical-align:top;width:160px;white-space:nowrap;">' + escapeHtml(r[0]) + '</td>' +
        '<td style="padding:6px 0;color:#111;word-break:break-word;">' + escapeHtml(r[1]) + '</td>' +
      '</tr>';
    }).join("") +
    '</table>' +
    '<p style="margin-top:28px;font-size:12px;color:#999;">Reply directly to this email to respond to the lead — the Reply-To header is set to their address.</p>' +
    '</div>';

  const form = new URLSearchParams();
  form.set("from", LEAD_FROM);
  form.set("to", LEAD_TO);
  form.set("subject", subject);
  form.set("text", text);
  form.set("html", html);
  if (lead.email) form.set("h:Reply-To", lead.email);

  try {
    const res = await fetch(`${MAILGUN_API_BASE}/${encodeURIComponent(MAILGUN_DOMAIN)}/messages`, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(`api:${MAILGUN_API_KEY}`).toString("base64")
      },
      body: form
    });
    if (!res.ok) {
      const t = await res.text();
      console.error("[lead] mailgun returned non-2xx:", res.status, t);
      return;
    }
    console.log("[lead] mailgun notification sent for", lead.email);
  } catch (err) {
    console.error("[lead] mailgun threw:", err);
  }
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/track", async (req, res) => {
  const b = req.body || {};
  const doc = {
    created_at:   FieldValue.serverTimestamp(),
    ip_address:   clientIp(req),
    user_agent:   pickString(b.user_agent, 500) || req.get("user-agent") || null,
    referrer:     pickString(b.referrer, 1000),
    path:         pickString(b.path, 500),
    query_string: pickString(b.query_string, 2000),
    utm_source:   pickString(b.utm_source, 200),
    utm_medium:   pickString(b.utm_medium, 200),
    utm_campaign: pickString(b.utm_campaign, 200),
    utm_content:  pickString(b.utm_content, 200),
    utm_term:     pickString(b.utm_term, 200),
    sa_click_id:  pickString(b.sa_click_id, 200)
  };

  try {
    await db.collection("pageviews").add(doc);
    res.json({ ok: true });
  } catch (err) {
    console.error("[track] firestore add error", err);
    res.status(500).json({ ok: false });
  }
});

app.post("/api/lead", async (req, res) => {
  const b = req.body || {};

  if (b.hp_check_xv) {
    // honeypot tripped — pretend success, do not store
    console.log("[lead] honeypot tripped; dropping payload");
    return res.json({ ok: true });
  }

  const first_name = pickString(b.first_name, 100);
  const last_name  = pickString(b.last_name, 100);
  const email      = pickString(b.email, 200);
  if (!first_name || !last_name || !email || !isEmail(email)) {
    return res.status(400).json({ ok: false, error: "Missing or invalid name/email." });
  }

  const doc = {
    created_at:   FieldValue.serverTimestamp(),
    status:       "new",
    first_name,
    last_name,
    email:        email.toLowerCase(),
    phone:        pickString(b.phone, 50),
    interest:     pickString(b.interest, 100),
    message:      pickString(b.message, 4000),
    ip_address:   clientIp(req),
    user_agent:   pickString(b.user_agent, 500) || req.get("user-agent") || null,
    referrer:     pickString(b.referrer, 1000),
    landing_page: pickString(b.landing_page, 1000),
    utm_source:   pickString(b.utm_source, 200),
    utm_medium:   pickString(b.utm_medium, 200),
    utm_campaign: pickString(b.utm_campaign, 200),
    utm_content:  pickString(b.utm_content, 200),
    utm_term:     pickString(b.utm_term, 200),
    sa_click_id:  pickString(b.sa_click_id, 200)
  };

  try {
    await db.collection("leads").add(doc);
    // Fire-and-forget the email; don't block the form response if Mailgun is slow/down
    notifyLead(doc).catch(function (err) { console.error("[lead] notifyLead unexpected throw:", err); });
    res.json({ ok: true });
  } catch (err) {
    console.error("[lead] firestore add error", err);
    res.status(500).json({ ok: false, error: "Could not save lead." });
  }
});

app.listen(PORT, () => {
  console.log(`agfintax-api (firestore) listening on :${PORT}`);
});
