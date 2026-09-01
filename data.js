/* ══════════════════════════════════════════════════════════════
   °CRYO Mongolia — public ↔ Supabase bridge
   · pushes bookings and contact requests into the admin dashboard
   · pulls live prices so admin edits appear on the site
   The site degrades gracefully: with no Supabase key everything
   keeps working against the static markup.
   ══════════════════════════════════════════════════════════════ */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const CFG = window.CRYO_SUPABASE || {};
const sb = CFG.url && CFG.anonKey ? createClient(CFG.url, CFG.anonKey) : null;

const money = (n) => Number(n || 0).toLocaleString("en-US");

window.cryoData = {
  ready: !!sb,

  async saveBooking(row) {
    if (!sb) return { skipped: true };
    try {
      return await sb.from("bookings").insert(row);
    } catch (e) {
      return { error: e };
    }
  },

  async saveMessage(row) {
    if (!sb) return { skipped: true };
    try {
      return await sb.from("contact_messages").insert(row);
    } catch (e) {
      return { error: e };
    }
  },
};

/* ── live prices ──────────────────────────────────────────────── */
(async function syncPrices() {
  if (!sb) return;

  const [svcRes, pkgRes] = await Promise.all([
    sb.from("services").select("slug,duration,price,active"),
    sb.from("packages").select("slug,old_price,price,period,active"),
  ]);

  (svcRes.data || []).forEach((s) => {
    document.querySelectorAll(`[data-svc="${CSS.escape(s.slug)}"]`).forEach((el) => {
      if (!s.active) {
        el.style.display = "none";
        return;
      }
      const amt = el.querySelector(".rate-amt");
      if (amt) amt.innerHTML = `<span>₮</span>${money(s.price)}`;

      const card = el.querySelector(".card-price");
      if (card) card.innerHTML = `<small>₮</small>${money(s.price)}`;

      const dur = el.querySelector(".rate-dur, .card-dur");
      if (dur && s.duration) dur.textContent = s.duration;
    });
  });

  (pkgRes.data || []).forEach((p) => {
    document.querySelectorAll(`[data-pkg="${CSS.escape(p.slug)}"]`).forEach((el) => {
      if (!p.active) {
        el.style.display = "none";
        return;
      }
      const old = el.querySelector(".pack-old, .io-old");
      if (old) old.textContent = "₮" + money(p.old_price);

      const now = el.querySelector(".pack-new, .io-new");
      if (now) now.innerHTML = `<span>₮</span>${money(p.price)}`;

      const per = el.querySelector(".pack-period");
      if (per && p.period) per.textContent = p.period;

      const save = el.querySelector(".io-save");
      if (save && p.old_price > 0 && p.price > 0) {
        const pct = Math.round((1 - p.price / p.old_price) * 100);
        if (pct > 0) save.textContent = pct + "% хөнгөлөлт";
      }
    });
  });
})();
