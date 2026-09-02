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
const DEVICES = [
  ["cryo_cabin", "Cabin", "f_cabin"],
  ["oxy_pro", "OxyPro", "f_oxy"],
  ["led_pro", "LedPro", "f_led"],
  ["x_cryo", "X°Cryo", "f_xcryo"],
  ["zerobody", "Zero", "f_zero"],
  ["normatec", "Norma", "f_norma"],
  ["oxygen", "Oxygen", "f_oxygen"],
];
const PAYS = [
  ["golomt", "Голомт", "f_golomt"],
  ["khan", "Хаан", "f_khan"],
  ["cash", "Бэлэн", "f_cash"],
  ["invoice", "Нэхэмжлэх", "f_invoice"],
  ["barter", "Barter", "f_barter"],
  ["refund", "Буцаалт", "f_refund"],
];

const ROLE_MN = {
  owner: "Үндсэн админ",
  admin: "Админ",
  staff: "Ажилтан",
  customer: "Үйлчлүүлэгч",
};

let sb = null;
let me = null; // { id, email, full_name, role }
let cache = {
  bookings: [], messages: [], services: [], packages: [], users: [], months: [],
  sales: [], expenses: [], staff: [],
};
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
  wireNav();
  wireBookingFilters();
  wireReports();
  wireLedger();
  wireExpenses();

  /* the login screen always renders; it just explains itself when the
     project has no anon key yet, instead of vanishing behind a setup page */
  if (!CFG.url || !CFG.anonKey) {
    show($("authGate"));
    show($("cfgWarn"));
    $("authBtn").disabled = true;
    $("authBtn").textContent = "Supabase холбогдоогүй";
    $("gateTabs").style.display = "none";
    return;
  }
  sb = createClient(CFG.url, CFG.anonKey);

  wireAuthForm();
  $("signOut").addEventListener("click", () => sb.auth.signOut());
  $("denyOut").addEventListener("click", () => sb.auth.signOut());
  $("refreshBtn").addEventListener("click", loadAll);

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
    sb.from("sales").select("*").order("sale_date", { ascending: false }).limit(5000),
    sb.from("expenses").select("*").order("spend_date", { ascending: false }).limit(2000),
    sb.from("staff").select("*").order("sort", { ascending: true }),
  ];
  const PROFILE_AT = jobs.length;
  if (me.role === "owner") {
    jobs.push(sb.from("profiles").select("*").order("created_at", { ascending: true }));
  }

  const res = await Promise.all(jobs);
  cache.bookings = res[0].data || [];
  cache.messages = res[1].data || [];
  cache.services = res[2].data || [];
  cache.packages = res[3].data || [];
  cache.months = res[4].data || [];
  cache.sales = res[5].data || [];
  cache.expenses = res[6].data || [];
  cache.staff = res[7].data || [];
  cache.users = res[PROFILE_AT] ? res[PROFILE_AT].data || [] : [];

  const firstErr = res.find((r) => r.error);
  if (firstErr && firstErr.error) {
    console.warn("[admin] load:", firstErr.error.message);
  }

  renderOverview();
  renderLedger();
  renderExpenses();
  renderReports();
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

function drawBars(svg, buckets) {
  svg.innerHTML = "";
  const NS = "http://www.w3.org/2000/svg";
  const W = 720, H = 210, padL = 8, padB = 26, padT = 12;
  const max = Math.max(1, ...buckets.map((b) => b.value));
  const bw = (W - padL * 2) / Math.max(1, buckets.length);

  /* a unique gradient per chart: a shared id resolves to the copy inside
     the hidden view, which Chrome then refuses to paint with */
  const gid = "barGrad-" + (svg.id || "x");
  const defs = document.createElementNS(NS, "defs");
  defs.innerHTML =
    '<linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
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

  const every = buckets.length > 24 ? Math.ceil(buckets.length / 12) : 1;
  buckets.forEach((b, i) => {
    const h = Math.max(2, ((H - padT - padB) * b.value) / max);
    const x = padL + i * bw + bw * 0.22;
    const y = H - padB - h;
    const r = document.createElementNS(NS, "rect");
    r.setAttribute("x", x); r.setAttribute("y", y);
    r.setAttribute("width", Math.max(1.5, bw * 0.56)); r.setAttribute("height", h);
    r.setAttribute("rx", Math.min(5, bw * 0.28));
    r.setAttribute("class", "bar");
    r.setAttribute("fill", "url(#" + gid + ")");
    const title = document.createElementNS(NS, "title");
    title.textContent = b.label + " · " + money(b.value);
    r.appendChild(title);
    svg.appendChild(r);

    if (i % every === 0) {
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", padL + i * bw + bw / 2);
      t.setAttribute("y", H - 8);
      t.setAttribute("text-anchor", "middle");
      t.textContent = b.label;
      svg.appendChild(t);
    }
  });
}

function drawChart() {
  const svg = $("revChart");
  const now = new Date();
  const buckets = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const row = cache.months.find((m) => String(m.month).slice(0, 7) === key);
    buckets.push({ label: d.getMonth() + 1 + "-р", value: row ? Number(row.revenue) : 0 });
  }

  drawBars(svg, buckets);
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
      ["customer", "staff", "admin", "owner"].forEach((r) => {
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


/* ══════════════════════════════════════════════════════════════
   REPORTS
   ══════════════════════════════════════════════════════════════ */

let repRange = "month";

function rangeBounds(kind) {
  const now = new Date();
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (kind === "month") {
    return [new Date(now.getFullYear(), now.getMonth(), 1), startOfDay(now)];
  }
  if (kind === "prev") {
    return [
      new Date(now.getFullYear(), now.getMonth() - 1, 1),
      new Date(now.getFullYear(), now.getMonth(), 0),
    ];
  }
  if (kind === "q") {
    return [new Date(now.getFullYear(), now.getMonth() - 2, 1), startOfDay(now)];
  }
  if (kind === "year") {
    return [new Date(now.getFullYear(), 0, 1), startOfDay(now)];
  }
  if (kind === "custom") {
    const f = $("repFrom").value, t = $("repTo").value;
    return [f ? new Date(f) : new Date(2000, 0, 1), t ? new Date(t) : new Date()];
  }
  return [new Date(2000, 0, 1), startOfDay(now)]; // all
}

function wireReports() {
  const filters = $("repFilters");
  if (!filters) return;

  filters.addEventListener("click", (e) => {
    const b = e.target.closest(".chip-btn");
    if (!b) return;
    filters.querySelectorAll(".chip-btn").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    repRange = b.dataset.range;
    renderReports();
  });

  ["repFrom", "repTo"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("change", () => {
      filters.querySelectorAll(".chip-btn").forEach((x) => x.classList.remove("on"));
      repRange = "custom";
      renderReports();
    });
  });

  const csv = $("repCsv");
  if (csv) csv.addEventListener("click", exportCsv);
  const pr = $("repPrint");
  if (pr) pr.addEventListener("click", () => window.print());
}

function reportRows() {
  const [from, to] = rangeBounds(repRange);
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999);
  return {
    from,
    to: end,
    rows: cache.bookings.filter((b) => {
      const d = new Date(b.created_at);
      return d >= from && d <= end;
    }),
  };
}

function renderReports() {
  if (!$("repRange")) return;
  const { from, to, rows } = reportRows();

  $("repRange").textContent = fmtDate(from) + " — " + fmtDate(to);

  const paid = rows.filter((b) => b.status === "confirmed" || b.status === "done");
  const revenue = paid.reduce((s, b) => s + (b.amount || 0), 0);
  const done = rows.filter((b) => b.status === "done").length;
  const rate = rows.length ? Math.round((done / rows.length) * 100) : 0;

  $("rRevenue").innerHTML = '<small>₮</small>' + revenue.toLocaleString("en-US");
  $("rRevenueNote").textContent = paid.length + " баталгаажсан захиалга";
  $("rCount").textContent = rows.length.toLocaleString("en-US");
  $("rCountNote").textContent =
    "Хүлээгдэж буй " + rows.filter((b) => b.status === "pending").length;
  $("rAvg").innerHTML =
    '<small>₮</small>' +
    (paid.length ? Math.round(revenue / paid.length) : 0).toLocaleString("en-US");
  $("rRate").innerHTML = rate + '<small style="margin:0 0 0 2px">%</small>';
  $("rRateNote").textContent = done + " / " + rows.length + " биелсэн";

  /* daily (or monthly for long ranges) trend */
  const spanDays = Math.round((to - from) / 86400000);
  const byMonth = spanDays > 92;
  const buckets = [];
  if (byMonth) {
    const cur = new Date(from.getFullYear(), from.getMonth(), 1);
    while (cur <= to) {
      const key = cur.getFullYear() + "-" + String(cur.getMonth() + 1).padStart(2, "0");
      const v = paid
        .filter((b) => String(b.created_at).slice(0, 7) === key)
        .reduce((s, b) => s + (b.amount || 0), 0);
      buckets.push({ label: cur.getMonth() + 1 + "-р", value: v });
      cur.setMonth(cur.getMonth() + 1);
    }
  } else {
    const cur = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    while (cur <= to) {
      const key =
        cur.getFullYear() +
        "-" + String(cur.getMonth() + 1).padStart(2, "0") +
        "-" + String(cur.getDate()).padStart(2, "0");
      const v = paid
        .filter((b) => String(b.created_at).slice(0, 10) === key)
        .reduce((s, b) => s + (b.amount || 0), 0);
      buckets.push({ label: String(cur.getDate()), value: v });
      cur.setDate(cur.getDate() + 1);
    }
  }
  drawBars($("repChart"), buckets);
  $("repTrendNote").textContent =
    (byMonth ? "Сараар" : "Өдрөөр") + " · нийт " + money(revenue);

  /* service / package breakdown */
  const agg = {};
  rows.forEach((b) => {
    const key = b.package || b.service || "Тодорхойгүй";
    agg[key] = agg[key] || { n: 0, sum: 0 };
    agg[key].n++;
    if (b.status === "confirmed" || b.status === "done") agg[key].sum += b.amount || 0;
  });
  const svcBody = $("repSvcBody");
  svcBody.innerHTML = "";
  const entries = Object.entries(agg).sort((a, b) => b[1].sum - a[1].sum);
  if (!entries.length) {
    svcBody.innerHTML =
      '<tr><td colspan="4"><div class="empty">Энэ хугацаанд захиалга алга.</div></td></tr>';
  } else {
    entries.forEach(([name, v]) => {
      const tr = document.createElement("tr");
      tr.appendChild(cell(name, "t-strong"));
      tr.appendChild(cell(v.n, "t-mono"));
      tr.appendChild(cell(money(v.sum), "t-mono"));
      tr.appendChild(shareCell(revenue ? (v.sum / revenue) * 100 : 0));
      svcBody.appendChild(tr);
    });
  }

  /* status breakdown */
  const stBody = $("repStatusBody");
  stBody.innerHTML = "";
  Object.keys(STATUS_MN).forEach((k) => {
    const list = rows.filter((b) => b.status === k);
    const sum = list.reduce((s, b) => s + (b.amount || 0), 0);
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = "pill st-" + k;
    pill.textContent = STATUS_MN[k];
    td.appendChild(pill);
    tr.appendChild(td);
    tr.appendChild(cell(list.length, "t-mono"));
    tr.appendChild(cell(money(sum), "t-mono"));
    tr.appendChild(shareCell(rows.length ? (list.length / rows.length) * 100 : 0));
    stBody.appendChild(tr);
  });
}

function shareCell(pct) {
  const td = document.createElement("td");
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;align-items:center;gap:10px;min-width:150px";
  const bar = document.createElement("div");
  bar.style.cssText =
    "flex:1;height:6px;border-radius:99px;background:rgba(150,205,255,.12);overflow:hidden";
  const fill = document.createElement("div");
  fill.style.cssText =
    "height:100%;border-radius:99px;background:linear-gradient(90deg,#b3e2ff,#1a7fc4);width:" +
    Math.max(0, Math.min(100, pct)).toFixed(1) + "%";
  bar.appendChild(fill);
  const lab = document.createElement("span");
  lab.className = "t-mono";
  lab.style.cssText = "font-size:12px;min-width:44px;text-align:right";
  lab.textContent = pct.toFixed(1) + "%";
  wrap.append(bar, lab);
  td.appendChild(wrap);
  return td;
}

function exportCsv() {
  const { from, to, rows } = reportRows();
  const head = [
    "Дугаар", "Үйлчлүүлэгч", "Утас", "Үйлчилгээ", "Багц",
    "Огноо", "Цаг", "Дүн", "Урьдчилгаа", "Банк", "Төлөв", "Үүссэн",
  ];
  const q = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  const lines = [head.map(q).join(",")];
  rows.forEach((b) => {
    lines.push(
      [
        b.ref, b.customer_name, b.phone, b.service, b.package,
        b.booked_date, b.booked_time, b.amount, b.deposit, b.bank,
        STATUS_MN[b.status] || b.status, b.created_at,
      ].map(q).join(","),
    );
  });

  // BOM so Excel opens the Cyrillic correctly
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download =
    "cryo-tailan-" + fmtDate(from).replace(/\./g, "") + "-" + fmtDate(to).replace(/\./g, "") + ".csv";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}




/* ══════════════════════════════════════════════════════════════
   SALES LEDGER — the daily book that used to live in the workbook
   ══════════════════════════════════════════════════════════════ */


let ledMonth = "all";
let ledStaff = "all";
let ledSearch = "";
let ledReviewOnly = false;
let ledEditing = null;
let ledLimit = 100;

const rowTotal = (r) =>
  (r.golomt || 0) + (r.khan || 0) + (r.cash || 0) + (r.invoice || 0) + (r.barter || 0) - (r.refund || 0);

function ledRows() {
  return cache.sales.filter((r) => {
    if (ledMonth !== "all" && String(r.sale_date).slice(0, 7) !== ledMonth) return false;
    if (ledStaff !== "all" && (r.therapist || "—") !== ledStaff) return false;
    if (ledReviewOnly && !r.needs_review) return false;
    if (ledSearch) {
      const hay = ((r.customer_name || "") + " " + (r.services || "") + " " + (r.note || "")).toLowerCase();
      if (!hay.includes(ledSearch)) return false;
    }
    return true;
  });
}

function wireLedger() {
  if (!$("ledBody")) return;
  $("ledMonth").addEventListener("change", () => {
    ledMonth = $("ledMonth").value;
    ledLimit = 100;
    renderLedger();
  });
  $("ledStaff").addEventListener("change", () => {
    ledStaff = $("ledStaff").value;
    ledLimit = 100;
    renderLedger();
  });
  $("ledSearch").addEventListener("input", () => {
    ledSearch = $("ledSearch").value.trim().toLowerCase();
    ledLimit = 100;
    renderLedger();
  });
  $("ledReview").addEventListener("change", () => {
    ledReviewOnly = $("ledReview").checked;
    ledLimit = 100;
    renderLedger();
  });
  $("ledAdd").addEventListener("click", () => openLedForm(null));
  $("ledCancel").addEventListener("click", () => {
    $("ledForm").style.display = "none";
    ledEditing = null;
  });
  $("ledSave").addEventListener("click", saveLedger);
  $("ledCsv").addEventListener("click", exportLedgerCsv);
  [...PAYS.map((p) => p[2])].forEach((id) =>
    $(id).addEventListener("input", updateFormTotal),
  );
}

function updateFormTotal() {
  const v = (id) => Number($(id).value) || 0;
  const t =
    v("f_golomt") + v("f_khan") + v("f_cash") + v("f_invoice") + v("f_barter") - v("f_refund");
  $("ledFormTotal").textContent = "Нийт: " + money(t);
}

function openLedForm(row) {
  ledEditing = row;
  $("ledFormTitle").textContent = row ? "Борлуулалт засах" : "Шинэ борлуулалт";
  $("f_date").value = row ? row.sale_date : new Date().toISOString().slice(0, 10);
  $("f_name").value = row ? row.customer_name || "" : "";
  $("f_svc").value = row ? row.services || "" : "";
  $("f_note").value = row ? row.note || "" : "";
  $("f_internal").checked = row ? !!row.is_internal : false;
  $("f_staffamt").value = row ? row.therapist_amount || 0 : 0;
  $("f_gift").value = row ? row.gift_card || 0 : 0;
  PAYS.forEach(([k, , id]) => ($(id).value = row ? row[k] || 0 : 0));
  DEVICES.forEach(([k, , id]) => ($(id).value = row ? row[k] || 0 : 0));

  const sel = $("f_staff");
  sel.innerHTML = '<option value="">—</option>';
  cache.staff.forEach((st) => {
    const o = document.createElement("option");
    o.value = st.name;
    o.textContent = st.name;
    if (row && row.therapist === st.name) o.selected = true;
    sel.appendChild(o);
  });

  updateFormTotal();
  $("ledForm").style.display = "";
  $("ledForm").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function saveLedger() {
  const btn = $("ledSave");
  const v = (id) => Number($(id).value) || 0;
  const patch = {
    sale_date: $("f_date").value,
    customer_name: $("f_name").value.trim() || null,
    services: $("f_svc").value.trim() || null,
    note: $("f_note").value.trim() || null,
    is_internal: $("f_internal").checked,
    therapist: $("f_staff").value || null,
    therapist_amount: v("f_staffamt"),
    gift_card: v("f_gift"),
    needs_review: false,
    source: ledEditing ? ledEditing.source : "manual",
  };
  PAYS.forEach(([k, , id]) => (patch[k] = v(id)));
  DEVICES.forEach(([k, , id]) => (patch[k] = v(id)));

  if (!patch.sale_date) return alert("Огноо оруулна уу.");

  btn.disabled = true;
  const res = ledEditing
    ? await sb.from("sales").update(patch).eq("id", ledEditing.id).select().maybeSingle()
    : await sb.from("sales").insert(patch).select().maybeSingle();
  btn.disabled = false;

  if (res.error) return alert("Хадгалж чадсангүй: " + res.error.message);

  if (ledEditing) {
    Object.assign(ledEditing, res.data || patch);
  } else if (res.data) {
    cache.sales.unshift(res.data);
  }
  $("ledForm").style.display = "none";
  ledEditing = null;
  renderLedger();
  renderReports();
}

function renderLedger() {
  const body = $("ledBody");
  if (!body) return;

  /* month + staff pickers, built from the data itself */
  const months = [...new Set(cache.sales.map((r) => String(r.sale_date).slice(0, 7)))].sort().reverse();
  const mSel = $("ledMonth");
  if (mSel.options.length !== months.length + 1) {
    mSel.innerHTML = '<option value="all">Бүх сар</option>';
    months.forEach((m) => {
      const o = document.createElement("option");
      o.value = m;
      o.textContent = m;
      mSel.appendChild(o);
    });
    mSel.value = ledMonth;
  }
  const staffNames = [...new Set(cache.sales.map((r) => r.therapist).filter(Boolean))].sort();
  const sSel = $("ledStaff");
  if (sSel.options.length !== staffNames.length + 1) {
    sSel.innerHTML = '<option value="all">Бүгд</option>';
    staffNames.forEach((n) => {
      const o = document.createElement("option");
      o.value = n;
      o.textContent = n;
      sSel.appendChild(o);
    });
    sSel.value = ledStaff;
  }

  const rows = ledRows();
  const total = rows.reduce((a, r) => a + rowTotal(r), 0);
  const review = rows.filter((r) => r.needs_review).length;

  const tiles = [
    ["Нийт орлого", "<small>₮</small>" + total.toLocaleString("en-US"), rows.length + " гүйлгээ"],
  ];
  PAYS.slice(0, 3).forEach(([k, label]) => {
    const v = rows.reduce((a, r) => a + (r[k] || 0), 0);
    tiles.push([label, "<small>₮</small>" + v.toLocaleString("en-US"),
      total ? Math.round((v / total) * 100) + "%" : "—"]);
  });
  $("ledKpis").innerHTML = tiles
    .map(
      ([l, v, n]) =>
        '<div class="kpi"><div class="kpi-label">' + l + '</div><div class="kpi-val">' + v +
        '</div><div class="kpi-note">' + n + "</div></div>",
    )
    .join("");
  $("ledSub").textContent =
    rows.length + " гүйлгээ" + (review ? " · " + review + " шалгах шаардлагатай" : "");

  body.innerHTML = "";
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="8"><div class="empty">Бүртгэл алга байна.</div></td></tr>';
    $("ledMore").textContent = "";
    return;
  }

  rows.slice(0, ledLimit).forEach((r) => {
    const tr = document.createElement("tr");
    if (r.needs_review) tr.className = "review";
    tr.appendChild(cell(r.sale_date, "t-mono"));

    const nm = document.createElement("td");
    nm.className = "t-strong";
    nm.textContent = r.customer_name || (r.needs_review ? "⚠ нэргүй" : "—");
    tr.appendChild(nm);

    const sv = document.createElement("td");
    sv.style.cssText = "max-width:220px;white-space:normal;line-height:1.5";
    sv.textContent = r.services || "—";
    tr.appendChild(sv);

    const dv = document.createElement("td");
    const chips = document.createElement("div");
    chips.className = "dev-chips";
    DEVICES.forEach(([k, label]) => {
      if (!r[k]) return;
      const c = document.createElement("span");
      c.className = "dev-chip";
      c.textContent = label + (r[k] > 1 ? " ×" + r[k] : "");
      chips.appendChild(c);
    });
    dv.appendChild(chips);
    tr.appendChild(dv);

    tr.appendChild(cell(r.therapist || "—"));

    const pay = document.createElement("td");
    const pc = document.createElement("div");
    pc.className = "pay-chips";
    PAYS.forEach(([k, label]) => {
      if (!r[k]) return;
      const c = document.createElement("span");
      c.className = "pay-chip " + k;
      c.textContent = label;
      pc.appendChild(c);
    });
    pay.appendChild(pc);
    tr.appendChild(pay);

    tr.appendChild(cell(money(rowTotal(r)), "t-mono t-strong"));

    const act = document.createElement("td");
    const ed = document.createElement("button");
    ed.className = "btn-sm ghost";
    ed.textContent = "Засах";
    ed.addEventListener("click", () => openLedForm(r));
    act.appendChild(ed);
    tr.appendChild(act);

    body.appendChild(tr);
  });

  if (rows.length > ledLimit) {
    $("ledMore").innerHTML = "";
    const b = document.createElement("button");
    b.className = "btn-sm ghost";
    b.textContent = "Цааш үзэх (" + (rows.length - ledLimit) + ")";
    b.addEventListener("click", () => {
      ledLimit += 200;
      renderLedger();
    });
    $("ledMore").appendChild(b);
  } else {
    $("ledMore").textContent = rows.length + " мөр";
  }
}

function exportLedgerCsv() {
  const rows = ledRows();
  const head = [
    "Огноо", "Үйлчлүүлэгч", "Үйлчилгээ", "Голомт", "Хаан", "Бэлэн", "Нэхэмжлэх",
    "Barter", "Буцаалт", "Нийт", "Cabin", "OxyPro", "LedPro", "XCryo", "Zerobody",
    "Normatec", "Oxygen", "Ажилтан", "Ажилтны дүн", "Gift card", "Дотоод", "Тэмдэглэл",
  ];
  const q = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  const lines = [head.map(q).join(",")];
  rows.forEach((r) => {
    lines.push(
      [
        r.sale_date, r.customer_name, r.services, r.golomt, r.khan, r.cash, r.invoice,
        r.barter, r.refund, rowTotal(r), r.cryo_cabin, r.oxy_pro, r.led_pro, r.x_cryo,
        r.zerobody, r.normatec, r.oxygen, r.therapist, r.therapist_amount, r.gift_card,
        r.is_internal ? "тийм" : "", r.note,
      ].map(q).join(","),
    );
  });
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "cryo-borluulalt-" + (ledMonth === "all" ? "bugd" : ledMonth) + ".csv";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}

/* ══════════════════════════════════════════════════════════════
   EXPENSES
   ══════════════════════════════════════════════════════════════ */
let expEditing = null;

function wireExpenses() {
  if (!$("expBody")) return;
  $("expAdd").addEventListener("click", () => openExpForm(null));
  $("expCancel").addEventListener("click", () => {
    $("expForm").style.display = "none";
    expEditing = null;
  });
  $("expSave").addEventListener("click", saveExpense);
}

function openExpForm(row) {
  expEditing = row;
  $("e_date").value = row ? row.spend_date : new Date().toISOString().slice(0, 10);
  $("e_item").value = row ? row.item || "" : "";
  $("e_qty").value = row ? (row.qty ?? "") : "";
  $("e_amount").value = row ? row.amount || 0 : 0;
  $("e_paid").value = row ? row.paid_with || "" : "";
  $("expForm").style.display = "";
}

async function saveExpense() {
  const btn = $("expSave");
  const patch = {
    spend_date: $("e_date").value,
    item: $("e_item").value.trim(),
    qty: $("e_qty").value === "" ? null : Number($("e_qty").value),
    amount: Number($("e_amount").value) || 0,
    paid_with: $("e_paid").value.trim() || null,
  };
  if (!patch.spend_date || !patch.item) return alert("Огноо, зарлагын нэрийг оруулна уу.");

  btn.disabled = true;
  const res = expEditing
    ? await sb.from("expenses").update(patch).eq("id", expEditing.id).select().maybeSingle()
    : await sb.from("expenses").insert(patch).select().maybeSingle();
  btn.disabled = false;
  if (res.error) return alert("Хадгалж чадсангүй: " + res.error.message);

  if (expEditing) Object.assign(expEditing, res.data || patch);
  else if (res.data) cache.expenses.unshift(res.data);
  $("expForm").style.display = "none";
  expEditing = null;
  renderExpenses();
  renderReports();
}

function renderExpenses() {
  const body = $("expBody");
  if (!body) return;
  body.innerHTML = "";
  const total = cache.expenses.reduce((a, r) => a + (r.amount || 0), 0);
  $("expSub").textContent = cache.expenses.length + " бичилт · нийт " + money(total);

  if (!cache.expenses.length) {
    body.innerHTML = '<tr><td colspan="6"><div class="empty">Зардал алга байна.</div></td></tr>';
    return;
  }
  cache.expenses.forEach((r) => {
    const tr = document.createElement("tr");
    tr.appendChild(cell(r.spend_date, "t-mono"));
    tr.appendChild(cell(r.item, "t-strong"));
    tr.appendChild(cell(r.qty ?? "—", "t-mono"));
    tr.appendChild(cell(money(r.amount), "t-mono"));
    tr.appendChild(cell(r.paid_with || "—"));
    const act = document.createElement("td");
    const ed = document.createElement("button");
    ed.className = "btn-sm ghost";
    ed.textContent = "Засах";
    ed.addEventListener("click", () => openExpForm(r));
    act.appendChild(ed);
    tr.appendChild(act);
    body.appendChild(tr);
  });
}
