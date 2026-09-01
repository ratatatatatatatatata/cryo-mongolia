/* ══════════════════════════════════════════════════════════════
   °CRYO Mongolia — admin dashboard
   Supabase auth + role-gated reporting. No build step.
   Roles: owner (grants admin) › admin (runs the centre) › staff (no access)
   ══════════════════════════════════════════════════════════════ */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const CFG = window.CRYO_SUPABASE || {};
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "");
const money = (n) => "₮" + Number(n || 0).toLocaleString("en-US");

const STATUS_MN = {
  pending: "Хүлээгдэж буй",
  confirmed: "Баталгаажсан",
  done: "Биелсэн",
  cancelled: "Цуцалсан",
};
const ROLE_MN = { owner: "Үндсэн админ", admin: "Админ", staff: "Ажилтан" };

let sb = null;
let me = null; // { id, email, full_name, role }
let cache = { bookings: [], messages: [], services: [], packages: [], users: [], months: [] };
let bkFilter = "all";

/* ── tiny DOM helpers ─────────────────────────────────────────── */
function show(el, on = true) {
  if (el) el.style.display = on ? "" : "none";
}
function cell(text, cls) {
  const td = document.createElement("td");
  if (cls) td.className = cls;
  td.textContent = esc(text);
  return td;
}
function notice(host, kind, text) {
  host.innerHTML = "";
  const d = document.createElement("div");
  d.className = "notice " + kind;
  d.textContent = text;
  host.appendChild(d);
}
function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d)) return esc(v);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

/* ══════════════════════════════════════════════════════════════
   BOOT
   ══════════════════════════════════════════════════════════════ */
(async function boot() {
  if (!CFG.url || !CFG.anonKey) {
    show($("setupGate"));
    return;
  }
  sb = createClient(CFG.url, CFG.anonKey);

  wireAuthForm();
  $("signOut").addEventListener("click", () => sb.auth.signOut());
  $("denyOut").addEventListener("click", () => sb.auth.signOut());
  $("refreshBtn").addEventListener("click", loadAll);
  wireNav();
  wireBookingFilters();

  sb.auth.onAuthStateChange(() => route());
  await route();
})();

async function route() {
  const { data } = await sb.auth.getSession();
  const session = data.session;

  if (!session) {
    me = null;
    show($("authGate"));
    show($("denyGate"), false);
    show($("shell"), false);
    return;
  }

  const { data: prof, error } = await sb
    .from("profiles")
    .select("id,email,full_name,role")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error) {
    show($("authGate"));
    notice($("authMsg"), "err", "Профайл уншиж чадсангүй: " + error.message);
    return;
  }

  me = prof || { id: session.user.id, email: session.user.email, role: "staff" };

  if (me.role !== "owner" && me.role !== "admin") {
    show($("authGate"), false);
    show($("shell"), false);
    show($("denyGate"));
    $("denyWho").textContent = me.email || "";
    return;
  }

  show($("authGate"), false);
  show($("denyGate"), false);
  show($("shell"));

  $("meMail").textContent = me.email || "";
  const badge = $("meRole");
  badge.textContent = ROLE_MN[me.role] || me.role;
  badge.className = "side-role role-" + me.role;
  show($("navUsers"), me.role === "owner");

  await loadAll();
}

/* ══════════════════════════════════════════════════════════════
   AUTH
   ══════════════════════════════════════════════════════════════ */
function wireAuthForm() {
  let mode = "signin";
  const tabs = document.querySelectorAll(".gate-tabs button");
  tabs.forEach((b) =>
    b.addEventListener("click", () => {
      tabs.forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      mode = b.dataset.mode;
      show($("nameField"), mode === "signup");
      $("authBtn").textContent = mode === "signup" ? "Бүртгүүлэх" : "Нэвтрэх";
      $("au_pass").setAttribute(
        "autocomplete",
        mode === "signup" ? "new-password" : "current-password",
      );
      $("authMsg").innerHTML = "";
    }),
  );

  $("authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("authBtn");
    const email = $("au_email").value.trim();
    const password = $("au_pass").value;
    btn.disabled = true;

    if (mode === "signup") {
      const { error } = await sb.auth.signUp({
        email,
        password,
        options: { data: { full_name: $("au_name").value.trim() } },
      });
      btn.disabled = false;
      if (error) return notice($("authMsg"), "err", error.message);
      notice(
        $("authMsg"),
        "ok",
        "Бүртгэл үүслээ. И-мэйл баталгаажуулалт асуувал шуудангаа шалгана уу. Дараа нь үндсэн админаас эрх авна.",
      );
      return;
    }

    const { error } = await sb.auth.signInWithPassword({ email, password });
    btn.disabled = false;
    if (error) notice($("authMsg"), "err", error.message);
  });
}

/* ══════════════════════════════════════════════════════════════
   NAV
   ══════════════════════════════════════════════════════════════ */
function wireNav() {
  document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-item[data-view]").forEach((b) => b.classList.remove("on"));
      btn.classList.add("on");
      const v = btn.dataset.view;
      document.querySelectorAll(".view").forEach((s) => {
        s.classList.toggle("on", s.dataset.panel === v);
      });
    });
  });
}

function wireBookingFilters() {
  $("bkFilters").addEventListener("click", (e) => {
    const b = e.target.closest(".chip-btn");
    if (!b) return;
    $("bkFilters")
      .querySelectorAll(".chip-btn")
      .forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    bkFilter = b.dataset.status;
    renderBookings();
  });
}

/* ══════════════════════════════════════════════════════════════
   DATA
   ══════════════════════════════════════════════════════════════ */
async function loadAll() {
  const jobs = [
    sb.from("bookings").select("*").order("created_at", { ascending: false }).limit(500),
    sb.from("contact_messages").select("*").order("created_at", { ascending: false }).limit(300),
    sb.from("services").select("*").order("sort", { ascending: true }),
    sb.from("packages").select("*").order("sort", { ascending: true }),
    sb.from("report_monthly").select("*"),
  ];
  if (me.role === "owner") {
    jobs.push(sb.from("profiles").select("*").order("created_at", { ascending: true }));
  }

  const res = await Promise.all(jobs);
  cache.bookings = res[0].data || [];
  cache.messages = res[1].data || [];
  cache.services = res[2].data || [];
  cache.packages = res[3].data || [];
  cache.months = res[4].data || [];
  cache.users = res[5] ? res[5].data || [] : [];

  const firstErr = res.find((r) => r.error);
  if (firstErr && firstErr.error) {
    console.warn("[admin] load:", firstErr.error.message);
  }

  renderOverview();
  renderBookings();
  renderMessages();
  renderServices();
  renderPackages();
  renderUsers();
}

/* ══════════════════════════════════════════════════════════════
   OVERVIEW
   ══════════════════════════════════════════════════════════════ */
function renderOverview() {
  const bk = cache.bookings;
  const now = new Date();
  const thisMonth = (d) => {
    const x = new Date(d);
    return x.getFullYear() === now.getFullYear() && x.getMonth() === now.getMonth();
  };

  const paid = bk.filter((b) => b.status === "confirmed" || b.status === "done");
  const revMonth = paid.filter((b) => thisMonth(b.created_at)).reduce((s, b) => s + (b.amount || 0), 0);
  const bkMonth = bk.filter((b) => thisMonth(b.created_at)).length;
  const pending = bk.filter((b) => b.status === "pending").length;
  const newMsg = cache.messages.filter((m) => !m.handled).length;

  $("kTotal").textContent = bk.length.toLocaleString("en-US");
  $("kTotalNote").textContent = `Энэ сард ${bkMonth}`;
  $("kRevenue").innerHTML = `<small>₮</small>${revMonth.toLocaleString("en-US")}`;
  $("kRevenueNote").textContent = `Баталгаажсан ${paid.filter((b) => thisMonth(b.created_at)).length} захиалга`;
  $("kPending").textContent = String(pending);
  $("kMsg").textContent = String(newMsg);
  $("ovSub").textContent = `${now.getFullYear()} оны ${now.getMonth() + 1}-р сар`;

  drawChart();
  renderTop();
}

function drawChart() {
  const svg = $("revChart");
  svg.innerHTML = "";
  const NS = "http://www.w3.org/2000/svg";

  // last 12 months, zero-filled
  const now = new Date();
  const buckets = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const row = cache.months.find((m) => String(m.month).slice(0, 7) === key);
    buckets.push({ label: d.getMonth() + 1 + "-р", value: row ? Number(row.revenue) : 0 });
  }

  const W = 720, H = 210, padL = 8, padB = 26, padT = 12;
  const max = Math.max(1, ...buckets.map((b) => b.value));
  const bw = (W - padL * 2) / buckets.length;

  const defs = document.createElementNS(NS, "defs");
  defs.innerHTML =
    '<linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="#b3e2ff"/><stop offset="100%" stop-color="#1a7fc4"/></linearGradient>';
  svg.appendChild(defs);

  for (let g = 0; g <= 3; g++) {
    const y = padT + ((H - padT - padB) / 3) * g;
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", padL); line.setAttribute("x2", W - padL);
    line.setAttribute("y1", y); line.setAttribute("y2", y);
    line.setAttribute("class", "grid");
    svg.appendChild(line);
  }

  buckets.forEach((b, i) => {
    const h = Math.max(2, ((H - padT - padB) * b.value) / max);
    const x = padL + i * bw + bw * 0.22;
    const y = H - padB - h;
    const r = document.createElementNS(NS, "rect");
    r.setAttribute("x", x); r.setAttribute("y", y);
    r.setAttribute("width", bw * 0.56); r.setAttribute("height", h);
    r.setAttribute("rx", Math.min(5, bw * 0.28));
    r.setAttribute("class", "bar");
    const title = document.createElementNS(NS, "title");
    title.textContent = `${b.label} · ${money(b.value)}`;
    r.appendChild(title);
    svg.appendChild(r);

    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", padL + i * bw + bw / 2);
    t.setAttribute("y", H - 8);
    t.setAttribute("text-anchor", "middle");
    t.textContent = b.label;
    svg.appendChild(t);
  });

  const total = buckets.reduce((s, b) => s + b.value, 0);
  $("chartNote").textContent = `12 сарын нийт: ${money(total)}`;
}

function renderTop() {
  const body = $("topBody");
  body.innerHTML = "";
  const agg = {};
  cache.bookings.forEach((b) => {
    const key = b.package || b.service || "—";
    agg[key] = agg[key] || { n: 0, sum: 0 };
    agg[key].n++;
    if (b.status === "confirmed" || b.status === "done") agg[key].sum += b.amount || 0;
  });
  const rows = Object.entries(agg).sort((a, b) => b[1].n - a[1].n).slice(0, 8);

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="3"><div class="empty">Захиалга алга байна.</div></td></tr>';
    return;
  }
  rows.forEach(([name, v]) => {
    const tr = document.createElement("tr");
    tr.appendChild(cell(name, "t-strong"));
    tr.appendChild(cell(v.n, "t-mono"));
    tr.appendChild(cell(money(v.sum), "t-mono"));
    body.appendChild(tr);
  });
}

/* ══════════════════════════════════════════════════════════════
   BOOKINGS
   ══════════════════════════════════════════════════════════════ */
function renderBookings() {
  const body = $("bkBody");
  body.innerHTML = "";
  const rows = cache.bookings.filter((b) => bkFilter === "all" || b.status === bkFilter);

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6"><div class="empty">Захиалга алга байна.</div></td></tr>';
    return;
  }

  rows.forEach((b) => {
    const tr = document.createElement("tr");
    tr.appendChild(cell(b.ref, "t-strong t-mono"));

    const who = document.createElement("td");
    who.innerHTML = "";
    const n = document.createElement("div");
    n.className = "t-strong";
    n.textContent = esc(b.customer_name);
    const p = document.createElement("div");
    p.style.cssText = "font-size:11.5px;color:var(--text-muted);margin-top:3px";
    p.textContent = esc(b.phone || "");
    who.append(n, p);
    tr.appendChild(who);

    tr.appendChild(cell(b.package || b.service || "—"));
    tr.appendChild(cell(`${fmtDate(b.booked_date)} · ${b.booked_time || "—"}`, "t-mono"));
    tr.appendChild(cell(money(b.amount), "t-mono"));

    const st = document.createElement("td");
    const sel = document.createElement("select");
    sel.className = "ctl sm";
    sel.style.maxWidth = "160px";
    Object.entries(STATUS_MN).forEach(([k, label]) => {
      const o = document.createElement("option");
      o.value = k;
      o.textContent = label;
      if (b.status === k) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", async () => {
      st.classList.add("saving");
      const { error } = await sb.from("bookings").update({ status: sel.value }).eq("id", b.id);
      st.classList.remove("saving");
      if (error) {
        alert("Хадгалж чадсангүй: " + error.message);
        sel.value = b.status;
        return;
      }
      b.status = sel.value;
      renderOverview();
    });
    st.appendChild(sel);
    tr.appendChild(st);

    body.appendChild(tr);
  });
}

/* ══════════════════════════════════════════════════════════════
   MESSAGES
   ══════════════════════════════════════════════════════════════ */
function renderMessages() {
  const body = $("msgBody");
  body.innerHTML = "";
  if (!cache.messages.length) {
    body.innerHTML = '<tr><td colspan="6"><div class="empty">Хүсэлт алга байна.</div></td></tr>';
    return;
  }
  cache.messages.forEach((m) => {
    const tr = document.createElement("tr");
    if (m.handled) tr.style.opacity = ".5";
    tr.appendChild(cell(fmtDate(m.created_at), "t-mono"));
    tr.appendChild(cell(m.name, "t-strong"));

    const c = document.createElement("td");
    c.innerHTML = "";
    const a = document.createElement("div");
    a.textContent = esc(m.phone || "");
    const b2 = document.createElement("div");
    b2.style.cssText = "font-size:11.5px;color:var(--text-muted);margin-top:3px";
    b2.textContent = esc(m.email || "");
    c.append(a, b2);
    tr.appendChild(c);

    tr.appendChild(cell(m.service || "—"));

    const msg = document.createElement("td");
    msg.style.cssText = "max-width:320px;white-space:normal;line-height:1.55";
    msg.textContent = esc(m.message || "");
    tr.appendChild(msg);

    const act = document.createElement("td");
    const btn = document.createElement("button");
    btn.className = "btn-sm " + (m.handled ? "ghost" : "primary");
    btn.textContent = m.handled ? "Буцаах" : "Хариулсан";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const { error } = await sb
        .from("contact_messages")
        .update({ handled: !m.handled })
        .eq("id", m.id);
      btn.disabled = false;
      if (error) return alert("Хадгалж чадсангүй: " + error.message);
      m.handled = !m.handled;
      renderMessages();
      renderOverview();
    });
    act.appendChild(btn);
    tr.appendChild(act);

    body.appendChild(tr);
  });
}

/* ══════════════════════════════════════════════════════════════
   SERVICES
   ══════════════════════════════════════════════════════════════ */
function renderServices() {
  const body = $("svcBody");
  body.innerHTML = "";
  if (!cache.services.length) {
    body.innerHTML =
      '<tr><td colspan="6"><div class="empty">Үйлчилгээ алга. schema.sql-ийг ажиллуулсан уу?</div></td></tr>';
    return;
  }
  cache.services.forEach((s) => {
    const tr = document.createElement("tr");
    tr.appendChild(cell(s.name, "t-strong"));
    tr.appendChild(cell(s.category || "—"));

    const dur = document.createElement("td");
    const durIn = document.createElement("input");
    durIn.className = "ctl sm";
    durIn.style.maxWidth = "110px";
    durIn.value = esc(s.duration || "");
    dur.appendChild(durIn);
    tr.appendChild(dur);

    const pr = document.createElement("td");
    const prIn = document.createElement("input");
    prIn.className = "ctl sm num";
    prIn.type = "number";
    prIn.min = "0";
    prIn.step = "1000";
    prIn.value = Number(s.price || 0);
    pr.appendChild(prIn);
    tr.appendChild(pr);

    const ac = document.createElement("td");
    const acIn = document.createElement("input");
    acIn.type = "checkbox";
    acIn.checked = !!s.active;
    acIn.style.cssText = "width:18px;height:18px;accent-color:#58c6ff;cursor:pointer";
    ac.appendChild(acIn);
    tr.appendChild(ac);

    tr.appendChild(
      saveCell(async () => {
        const patch = {
          duration: durIn.value.trim(),
          price: Number(prIn.value) || 0,
          active: acIn.checked,
          updated_at: new Date().toISOString(),
        };
        const { error } = await sb.from("services").update(patch).eq("id", s.id);
        if (error) throw error;
        Object.assign(s, patch);
      }),
    );
    body.appendChild(tr);
  });
}

/* ══════════════════════════════════════════════════════════════
   PACKAGES
   ══════════════════════════════════════════════════════════════ */
function renderPackages() {
  const body = $("pkgBody");
  body.innerHTML = "";
  if (!cache.packages.length) {
    body.innerHTML =
      '<tr><td colspan="7"><div class="empty">Багц алга. schema.sql-ийг ажиллуулсан уу?</div></td></tr>';
    return;
  }
  cache.packages.forEach((p) => {
    const tr = document.createElement("tr");

    const nm = document.createElement("td");
    const t1 = document.createElement("div");
    t1.className = "t-strong";
    t1.textContent = esc(p.name);
    const t2 = document.createElement("div");
    t2.style.cssText = "font-size:11.5px;color:var(--text-muted);margin-top:3px";
    t2.textContent = esc(p.kicker || "");
    nm.append(t1, t2);
    tr.appendChild(nm);

    tr.appendChild(cell(p.period || "—"));

    const oldTd = document.createElement("td");
    const oldIn = document.createElement("input");
    oldIn.className = "ctl sm num";
    oldIn.type = "number";
    oldIn.min = "0";
    oldIn.step = "1000";
    oldIn.value = Number(p.old_price || 0);
    oldTd.appendChild(oldIn);
    tr.appendChild(oldTd);

    const newTd = document.createElement("td");
    const newIn = document.createElement("input");
    newIn.className = "ctl sm num";
    newIn.type = "number";
    newIn.min = "0";
    newIn.step = "1000";
    newIn.value = Number(p.price || 0);
    newTd.appendChild(newIn);
    tr.appendChild(newTd);

    const ft = document.createElement("td");
    const ftIn = document.createElement("input");
    ftIn.type = "checkbox";
    ftIn.checked = !!p.featured;
    ftIn.style.cssText = "width:18px;height:18px;accent-color:#58c6ff;cursor:pointer";
    ft.appendChild(ftIn);
    tr.appendChild(ft);

    const ac = document.createElement("td");
    const acIn = document.createElement("input");
    acIn.type = "checkbox";
    acIn.checked = !!p.active;
    acIn.style.cssText = "width:18px;height:18px;accent-color:#58c6ff;cursor:pointer";
    ac.appendChild(acIn);
    tr.appendChild(ac);

    tr.appendChild(
      saveCell(async () => {
        const patch = {
          old_price: Number(oldIn.value) || 0,
          price: Number(newIn.value) || 0,
          featured: ftIn.checked,
          active: acIn.checked,
          updated_at: new Date().toISOString(),
        };
        const { error } = await sb.from("packages").update(patch).eq("id", p.id);
        if (error) throw error;
        Object.assign(p, patch);
      }),
    );
    body.appendChild(tr);
  });
}

function saveCell(run) {
  const td = document.createElement("td");
  const btn = document.createElement("button");
  btn.className = "btn-sm primary";
  btn.textContent = "Хадгалах";
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const old = btn.textContent;
    try {
      await run();
      btn.textContent = "✓ Хадгаллаа";
      setTimeout(() => {
        btn.textContent = old;
        btn.disabled = false;
      }, 1400);
    } catch (e) {
      btn.disabled = false;
      alert("Хадгалж чадсангүй: " + (e.message || e));
    }
  });
  td.appendChild(btn);
  return td;
}

/* ══════════════════════════════════════════════════════════════
   USERS — owner only
   ══════════════════════════════════════════════════════════════ */
function renderUsers() {
  const body = $("usrBody");
  if (!body) return;
  body.innerHTML = "";
  if (me.role !== "owner") return;

  if (!cache.users.length) {
    body.innerHTML = '<tr><td colspan="4"><div class="empty">Хэрэглэгч алга байна.</div></td></tr>';
    return;
  }

  cache.users.forEach((u) => {
    const tr = document.createElement("tr");
    tr.appendChild(cell(u.email, "t-strong"));
    tr.appendChild(cell(u.full_name || "—"));
    tr.appendChild(cell(fmtDate(u.created_at), "t-mono"));

    const rl = document.createElement("td");
    if (u.id === me.id) {
      const span = document.createElement("span");
      span.className = "pill st-confirmed";
      span.textContent = ROLE_MN[u.role] + " (та)";
      rl.appendChild(span);
    } else {
      const sel = document.createElement("select");
      sel.className = "ctl sm";
      sel.style.maxWidth = "180px";
      ["staff", "admin", "owner"].forEach((r) => {
        const o = document.createElement("option");
        o.value = r;
        o.textContent = ROLE_MN[r];
        if (u.role === r) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener("change", async () => {
        const next = sel.value;
        if (next === "owner" && !confirm(`${u.email} хаягт БҮРЭН эрх өгөх үү?`)) {
          sel.value = u.role;
          return;
        }
        rl.classList.add("saving");
        const { error } = await sb.from("profiles").update({ role: next }).eq("id", u.id);
        rl.classList.remove("saving");
        if (error) {
          alert("Эрх солиж чадсангүй: " + error.message);
          sel.value = u.role;
          return;
        }
        u.role = next;
      });
      rl.appendChild(sel);
    }
    tr.appendChild(rl);
    body.appendChild(tr);
  });
}
