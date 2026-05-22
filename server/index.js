const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const PORT = process.env.PORT || 8080;
const FIREBASE_PROJECT_ID    = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_CLIENT_EMAIL  = process.env.FIREBASE_CLIENT_EMAIL;
const FIREBASE_PRIVATE_KEY   = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const ALLOWED_ORIGIN = (process.env.ALLOWED_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);

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
    if (!origin) return cb(null, true); // same-origin / curl / server-to-server
    if (ALLOWED_ORIGIN.length === 0) return cb(null, true); // permissive if unconfigured
    if (ALLOWED_ORIGIN.includes(origin)) return cb(null, true);
    return cb(new Error("Origin not allowed: " + origin));
  }
}));

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
    res.json({ ok: true });
  } catch (err) {
    console.error("[lead] firestore add error", err);
    res.status(500).json({ ok: false, error: "Could not save lead." });
  }
});

app.listen(PORT, () => {
  console.log(`agfintax-api (firestore) listening on :${PORT}`);
});
