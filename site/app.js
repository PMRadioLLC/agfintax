(function () {
  "use strict";

  var CONFIG = window.AGFT_CONFIG || {};
  var API_BASE = (CONFIG.apiBase || "").replace(/\/$/, "");

  var UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  var ATTRIBUTION_STORAGE_KEY = "agft_attribution";

  function captureAttribution() {
    var params = new URLSearchParams(window.location.search);
    var fromUrl = {};
    var hasUtm = false;
    UTM_KEYS.forEach(function (k) {
      var v = params.get(k);
      if (v) { fromUrl[k] = v; hasUtm = true; }
    });
    // StackAdapt click id variations — capture any of them as utm_content backup
    ["sa_click_id", "stackadapt_click_id", "sa_cid"].forEach(function (k) {
      var v = params.get(k);
      if (v) { fromUrl[k] = v; hasUtm = true; }
    });

    var stored;
    try { stored = JSON.parse(sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY) || "null"); } catch (_) {}

    var attribution = stored && !hasUtm ? stored : Object.assign({}, stored || {}, fromUrl);
    attribution.referrer = attribution.referrer || document.referrer || null;
    attribution.landing_page = attribution.landing_page || window.location.pathname + window.location.search;

    try { sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(attribution)); } catch (_) {}
    return attribution;
  }

  function postJSON(path, body) {
    return fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "omit",
      keepalive: true
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) { throw new Error("HTTP " + res.status + ": " + t); });
      }
      return res.json().catch(function () { return {}; });
    });
  }

  function trackPageview(attribution) {
    var payload = {
      path: window.location.pathname,
      query_string: window.location.search,
      referrer: document.referrer || null,
      user_agent: navigator.userAgent,
      utm_source:   attribution.utm_source || null,
      utm_medium:   attribution.utm_medium || null,
      utm_campaign: attribution.utm_campaign || null,
      utm_content:  attribution.utm_content || null,
      utm_term:     attribution.utm_term || null,
      sa_click_id:  attribution.sa_click_id || attribution.stackadapt_click_id || attribution.sa_cid || null
    };
    postJSON("/api/track", payload).catch(function (e) { console.warn("[agft] track failed", e); });
  }

  // Fires the StackAdapt conversion event after a successful form submit.
  // The universal pixel (saq) is loaded in index.html; this just records the
  // conversion against a specific Conversion Pixel ID created in the
  // StackAdapt dashboard. Replace the placeholder ID below with the real one.
  var STACKADAPT_CONVERSION_ID = "REPLACE_WITH_CONVERSION_PIXEL_ID"; // TODO(stackadapt)
  window.saConversion = function () {
    if (typeof window.saq !== "function") return;
    if (STACKADAPT_CONVERSION_ID === "REPLACE_WITH_CONVERSION_PIXEL_ID") {
      console.warn("[agft] StackAdapt conversion pixel ID not set; skipping.");
      return;
    }
    window.saq("conv", STACKADAPT_CONVERSION_ID);
  };

  function showError(form, msg) {
    var el = form.querySelector("#form-error");
    el.textContent = msg;
    el.style.display = "block";
  }

  function setSubmitted(form) {
    var btn = form.querySelector(".form-submit");
    btn.innerHTML = "Sent — we'll be in touch ✓";
    btn.disabled = true;
  }

  function bindForm(attribution) {
    var form = document.getElementById("lead-form");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var errEl = form.querySelector("#form-error");
      errEl.style.display = "none";

      // honeypot
      var hp = form.querySelector('input[name="website"]');
      if (hp && hp.value) { setSubmitted(form); return; }

      var fd = new FormData(form);
      var data = {
        first_name: (fd.get("first_name") || "").toString().trim(),
        last_name:  (fd.get("last_name")  || "").toString().trim(),
        email:      (fd.get("email")      || "").toString().trim(),
        phone:      (fd.get("phone")      || "").toString().trim() || null,
        interest:   (fd.get("interest")   || "").toString(),
        message:    (fd.get("message")    || "").toString().trim() || null,
        user_agent: navigator.userAgent,
        referrer:   document.referrer || null,
        landing_page: attribution.landing_page || null,
        utm_source:   attribution.utm_source   || null,
        utm_medium:   attribution.utm_medium   || null,
        utm_campaign: attribution.utm_campaign || null,
        utm_content:  attribution.utm_content  || null,
        utm_term:     attribution.utm_term     || null,
        sa_click_id:  attribution.sa_click_id || attribution.stackadapt_click_id || attribution.sa_cid || null
      };

      if (!data.first_name || !data.last_name || !data.email) {
        showError(form, "Please fill in your name and email.");
        return;
      }

      var btn = form.querySelector(".form-submit");
      btn.disabled = true;
      btn.innerHTML = "Sending…";

      postJSON("/api/lead", data)
        .then(function () {
          setSubmitted(form);
          try { window.saConversion(); } catch (e) { console.warn("[agft] saConversion threw", e); }
        })
        .catch(function (err) {
          console.error("[agft] lead submit failed", err);
          btn.disabled = false;
          btn.innerHTML = 'Book free consultation <span class="arrow">→</span>';
          showError(form, "Something went wrong sending your details. Please call (469) 942-9888 or email Hello@agfintax.com.");
        });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var attribution = captureAttribution();
    trackPageview(attribution);
    bindForm(attribution);
  });
})();
