/* ══════════════════════════════════════════════════════════════
   °CRYO Mongolia — admin dashboard
   Supabase auth + role-gated reporting. No build step.
   Roles: owner (grants admin) › admin (runs the centre) › staff (own sales and attendance)
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

const ADMIN_ONLY_NAV = [
  "navOverview", "navCoverage", "navExpenses", "navBookings", "navMessages", "navServices",
  "navPackages", "navStaff", "navInventory", "navUsers",
];

let sb = null;
let me = null; // { id, email, full_name, role }
let cache = {
  bookings: [], messages: [], services: [], packages: [], users: [], months: [],
  sales: [], expenses: [], staff: [], customers: [], attendance: [], workdays: [], inventory: [],
};
let bkFilter = "all";
let overviewYear = String(new Date().getFullYear());
let attendanceYear = "all";
let attendanceStaff = "all";

/* ── tiny DOM helpers ─────────────────────────────────────────── */
function show(el, on = true) {
  if (el) el.style.display = on ? "" : "none";
}
function isAdminUser() {
  return me?.role === "owner" || me?.role === "admin";
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
  wireOverview();
  wireBookingFilters();
  wireReports();
  wireLedger();
  wireImport();
  wireExpenses();
  wireCustomers();
  wireStaff();
  wireAttendance();
  wireInventory();

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

  if (me.role !== "owner" && me.role !== "admin" && me.role !== "staff") {
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
  const isAdmin = me.role === "owner" || me.role === "admin";
  ADMIN_ONLY_NAV.forEach((id) => show($(id), isAdmin && (id !== "navUsers" || me.role === "owner")));
  show($("navCustomers"), true);
  show($("navReports"), true);
  show($("navAttendance"), true);
  show($("attAdd"), isAdmin);
  show($("ledImport"), isAdmin);
  show($("ledReviewWrap"), isAdmin);

  $("navReports").lastChild.textContent = me.role === "staff" ? " Өнөөдрийн борлуулалт" : " Борлуулалт, тайлан";
  $("repTitle").textContent = me.role === "staff" ? "Өнөөдрийн борлуулалт" : "Тайлан";
  show($("repFiltersPanel"), isAdmin);

  if (!isAdmin) {
    switchView("reports");
  }

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

function switchView(view) {
  document.querySelectorAll(".nav-item[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === (view === "ledger" ? "reports" : view)));
  document.querySelectorAll(".view").forEach((s) => s.classList.toggle("on", s.dataset.panel === view));
  window.scrollTo({ top: 0, behavior: "smooth" });
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
    sb.from("sales").select("*").is("archived_at", null).order("sale_date", { ascending: false }).limit(5000),
    sb.from("expenses").select("*").order("spend_date", { ascending: false }).limit(2000),
    sb.from("staff").select("*").order("sort", { ascending: true }),
    sb.from("customers").select("id,full_name,phone,email,created_at").order("updated_at", { ascending: false }).limit(1000),
    sb.from("attendance").select("*").order("work_date", { ascending: false }).limit(1000),
    sb.from("inventory_items").select("*").order("name", { ascending: true }).limit(1000),
    sb.from("staff_workdays").select("*").order("work_date", { ascending: false }).limit(2000),
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
  cache.customers = res[8].data || [];
  cache.attendance = res[9].data || [];
  cache.inventory = res[10].data || [];
  cache.workdays = res[11].data || [];
  cache.users = res[PROFILE_AT] ? res[PROFILE_AT].data || [] : [];

  const firstErr = res.find((r) => r.error);
  if (firstErr && firstErr.error) {
    console.warn("[admin] load:", firstErr.error.message);
  }

  renderOverview();
  renderCoverage();
  renderLedger();
  renderExpenses();
  renderReports();
  renderBookings();
  renderMessages();
  renderServices();
  renderPackages();
  renderUsers();
  renderCustomers();
  renderStaff();
  renderAttendance();
  renderInventory();
}

function renderCoverage() {
  const body = $("coverageBody");
  if (!body) return;
  const rows = [
    ["2026 борлуулалт", 1031, cache.sales.length, "imported"],
    ["2025 борлуулалт", "review", 0, "missing"],
    ["Зардал", 330, cache.expenses.length, "partial"],
    ["Үйлчлүүлэгч", 115, cache.customers.length, "partial"],
    ["Үйлчилгээний нэр", 35, cache.services.filter((x) => x.category === "legacy-import").length, "partial"],
    ["Үйлчилгээний session", 2829, 0, "missing"],
    ["Хэрэглэгчийн багц", 245, 0, "missing"],
    ["Ирц", 320, cache.attendance.length, "partial"],
    ["Азот / бараа материал", 69, cache.inventory.length, "partial"],
    ["Цалин", 254, 0, "missing"],
  ];
  body.innerHTML = "";
  const labels = { imported: "Баталгаатай орсон", partial: "Хэсэгчилсэн", missing: "Ороогүй" };
  rows.forEach(([name, expected, actual, state]) => {
    const tr = document.createElement("tr");
    tr.appendChild(cell(name, "t-strong"));
    tr.appendChild(cell(String(expected)));
    tr.appendChild(cell(String(actual)));
    const status = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = "pill " + (state === "imported" ? "st-confirmed" : state === "partial" ? "st-pending" : "st-cancelled");
    pill.textContent = labels[state];
    status.appendChild(pill); tr.appendChild(status); body.appendChild(tr);
  });
}

/* ══════════════════════════════════════════════════════════════
   CUSTOMERS — one searchable record instead of repeated workbook names
   ══════════════════════════════════════════════════════════════ */

function normalizePhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("976") && digits.length === 11) digits = digits.slice(3);
  return digits;
}

function wireCustomers() {
  if (!$("cusBody")) return;
  $("cusSearch").addEventListener("input", renderCustomers);
  $("cusAdd").addEventListener("click", () => {
    $("cusForm").style.display = "";
    $("cusName").focus();
  });
  $("cusCancel").addEventListener("click", () => {
    $("cusForm").style.display = "none";
  });
  $("cusSave").addEventListener("click", saveCustomer);
}

async function saveCustomer() {
  const fullName = $("cusName").value.trim().replace(/\s+/g, " ");
  const phone = normalizePhone($("cusPhone").value);
  const email = $("cusEmail").value.trim().toLowerCase();
  const note = $("cusNote").value.trim();
  if (!fullName) return alert("Үйлчлүүлэгчийн нэр оруулна уу.");
  if (phone.length !== 8) return alert("Утасны дугаарыг 8 оронтой оруулна уу.");

  const duplicate = cache.customers.find((c) => normalizePhone(c.phone) === phone);
  if (duplicate) return alert("Энэ утасны дугаартай үйлчлүүлэгч бүртгэлтэй байна.");

  const btn = $("cusSave");
  btn.disabled = true;
  const { data, error } = await sb.from("customers").insert({
    full_name: fullName,
    phone,
    email: email || null,
    notes: note || null,
    source: "manual",
  }).select("id,full_name,phone,email,created_at").single();
  btn.disabled = false;
  if (error) return alert("Хадгалж чадсангүй: " + error.message);

  cache.customers.unshift(data);
  ["cusName", "cusPhone", "cusEmail", "cusNote"].forEach((id) => ($(id).value = ""));
  $("cusForm").style.display = "none";
  renderCustomers();
}

function renderCustomers() {
  const body = $("cusBody");
  if (!body) return;
  const query = $("cusSearch").value.trim().toLowerCase();
  const digits = normalizePhone(query);
  const rows = cache.customers.filter((c) => {
    if (!query) return true;
    return String(c.full_name || "").toLowerCase().includes(query) ||
      (digits && normalizePhone(c.phone).includes(digits));
  });

  $("cusSub").textContent = `${rows.length} үйлчлүүлэгч · нэр, утсаар хайна`;
  body.innerHTML = "";
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="4"><div class="empty">Үйлчлүүлэгч олдсонгүй.</div></td></tr>';
    return;
  }
  rows.forEach((customer) => {
    const tr = document.createElement("tr");
    tr.appendChild(cell(customer.full_name, "t-strong"));
    tr.appendChild(cell(customer.phone || "—", "t-mono"));
    tr.appendChild(cell(customer.email || "—"));
    tr.appendChild(cell(fmtDate(customer.created_at), "t-mono"));
    body.appendChild(tr);
  });
}

/* ══════════════════════════════════════════════════════════════
   OVERVIEW
   ══════════════════════════════════════════════════════════════ */
function availableYears() {
  return [...new Set(cache.sales.map((row) => String(row.sale_date || "").slice(0, 4)).filter((y) => /^\d{4}$/.test(y)))]
    .sort((a, b) => Number(b) - Number(a));
}

function salesInYear(year) {
  return year === "all" ? cache.sales : cache.sales.filter((row) => String(row.sale_date || "").startsWith(year + "-"));
}

function allAttendanceRows() {
  return [
    ...cache.attendance.map((row) => ({ ...row, __table: "attendance", __source: "ERP" })),
    ...cache.workdays.map((row) => ({ ...row, __table: "staff_workdays", __source: "Excel" })),
  ];
}

function fillYearSelect(select, includeAll = true) {
  if (!select) return;
  const current = select.value;
  const years = availableYears();
  select.innerHTML = includeAll ? '<option value="all">Бүх хугацаа</option>' : "";
  years.forEach((year) => {
    const option = document.createElement("option");
    option.value = year;
    option.textContent = year + " он";
    select.appendChild(option);
  });
  if ([...(select.options || [])].some((option) => option.value === current)) select.value = current;
}

function wireOverview() {
  $("ovYear")?.addEventListener("change", (event) => {
    overviewYear = event.target.value;
    renderOverview();
  });
}

function renderOverview() {
  fillYearSelect($("ovYear"));
  if (![...$("ovYear").options].some((option) => option.value === overviewYear)) {
    overviewYear = availableYears()[0] || "all";
  }
  $("ovYear").value = overviewYear;

  const rows = salesInYear(overviewYear);
  const revenue = rows.reduce((sum, row) => sum + rowTotal(row), 0);
  const previousYear = overviewYear === "all" ? null : String(Number(overviewYear) - 1);
  let previousRows = previousYear ? salesInYear(previousYear) : [];
  if (overviewYear === String(new Date().getFullYear())) {
    const cutoff = `${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`;
    previousRows = previousRows.filter((row) => String(row.sale_date || "").slice(5, 10) <= cutoff);
  }
  const previousRevenue = previousRows.reduce((sum, row) => sum + rowTotal(row), 0);
  const change = previousRevenue ? ((revenue - previousRevenue) / previousRevenue) * 100 : null;
  const attendanceRows = allAttendanceRows().filter((row) => overviewYear === "all" || String(row.work_date || "").startsWith(overviewYear + "-"));

  $("kRevenue").innerHTML = `<small>₮</small>${revenue.toLocaleString("en-US")}`;
  $("kRevenueNote").textContent = overviewYear === "all" ? "Бүх идэвхтэй борлуулалт" : `${overviewYear} оны борлуулалт`;
  $("kPrevRevenue").innerHTML = `<small>₮</small>${previousRevenue.toLocaleString("en-US")}`;
  $("kPrevRevenueNote").textContent = previousYear
    ? `${previousYear} он${change === null ? " · харьцуулах өгөгдөлгүй" : ` · ${change >= 0 ? "+" : ""}${change.toFixed(1)}%`}`
    : "Бүх хугацаанд харьцуулалт хамаарахгүй";
  $("kTotal").textContent = rows.length.toLocaleString("en-US");
  $("kTotalNote").textContent = rows.length ? `Дундаж ${money(Math.round(revenue / rows.length))}` : "Борлуулалт алга";
  $("kAttendance").textContent = attendanceRows.length.toLocaleString("en-US");
  $("kAttendanceNote").textContent = `${new Set(attendanceRows.map((row) => row.staff_id || row.staff_name)).size} ажилтан`;
  $("ovSub").textContent = overviewYear === "all" ? "Бүх хугацааны нэгдсэн үзүүлэлт" : `${overviewYear} оны борлуулалт, ирцийн үзүүлэлт`;

  drawChart(rows);
  renderTop(rows);
  renderOverviewStaff(rows, attendanceRows);
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

function drawChart(rows) {
  const svg = $("revChart");
  const buckets = [];
  if (overviewYear === "all") {
    availableYears().slice().reverse().forEach((year) => {
      const value = salesInYear(year).reduce((sum, row) => sum + rowTotal(row), 0);
      buckets.push({ label: year, value });
    });
    $("chartTitle").textContent = "Жилийн борлуулалт";
  } else {
    for (let month = 0; month < 12; month++) {
      const key = `${overviewYear}-${String(month + 1).padStart(2, "0")}`;
      const value = rows.filter((row) => String(row.sale_date || "").slice(0, 7) === key)
        .reduce((sum, row) => sum + rowTotal(row), 0);
      buckets.push({ label: month + 1 + "-р", value });
    }
    $("chartTitle").textContent = `${overviewYear} оны сарын борлуулалт`;
  }

  drawBars(svg, buckets);
  const total = buckets.reduce((s, b) => s + b.value, 0);
  $("chartNote").textContent = `Нийт: ${money(total)}`;
}

function renderTop(rows) {
  const body = $("topBody");
  body.innerHTML = "";
  const agg = {};
  rows.forEach((b) => {
    const key = b.services || "Тодорхойгүй";
    agg[key] = agg[key] || { n: 0, sum: 0 };
    agg[key].n++;
    agg[key].sum += rowTotal(b);
  });
  const entries = Object.entries(agg).sort((a, b) => b[1].sum - a[1].sum).slice(0, 8);

  if (!entries.length) {
    body.innerHTML = '<tr><td colspan="3"><div class="empty">Борлуулалт алга байна.</div></td></tr>';
    return;
  }
  entries.forEach(([name, v]) => {
    const tr = document.createElement("tr");
    tr.appendChild(cell(name, "t-strong"));
    tr.appendChild(cell(v.n, "t-mono"));
    tr.appendChild(cell(money(v.sum), "t-mono"));
    body.appendChild(tr);
  });
}

function renderOverviewStaff(salesRows, attendanceRows) {
  const body = $("ovStaffBody");
  if (!body) return;
  const entries = cache.staff.map((staff) => {
    const names = [staff.name, ...(staff.aliases || [])].map((name) => String(name || "").trim().toLowerCase()).filter(Boolean);
    const staffSales = salesRows.filter((sale) => Number(sale.staff_id) === Number(staff.id) || (!sale.staff_id && names.includes(String(sale.therapist || "").trim().toLowerCase())));
    const staffAttendance = attendanceRows.filter((row) => Number(row.staff_id) === Number(staff.id) || (!row.staff_id && names.includes(String(row.staff_name || "").trim().toLowerCase())));
    return {
      name: staff.name,
      count: staffSales.length,
      revenue: staffSales.reduce((sum, sale) => sum + rowTotal(sale), 0),
      days: staffAttendance.length,
    };
  }).filter((row) => row.count || row.days).sort((a, b) => b.revenue - a.revenue);

  body.innerHTML = "";
  $("ovStaffNote").textContent = `${entries.length} ажилтны үзүүлэлт`;
  if (!entries.length) {
    body.innerHTML = '<tr><td colspan="4"><div class="empty">Энэ хугацаанд ажилтны үзүүлэлт алга.</div></td></tr>';
    return;
  }
  entries.forEach((row) => {
    const tr = document.createElement("tr");
    tr.appendChild(cell(row.name, "t-strong"));
    tr.appendChild(cell(row.count, "t-mono"));
    tr.appendChild(cell(money(row.revenue), "t-mono t-strong"));
    tr.appendChild(cell(`${row.days} өдөр`, "t-mono"));
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
      '<tr><td colspan="6"><div class="empty">Үйлчилгээ алга. setup.sql-ийг ажиллуулсан уу?</div></td></tr>';
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
      '<tr><td colspan="7"><div class="empty">Багц алга. setup.sql-ийг ажиллуулсан уу?</div></td></tr>';
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
let repSelectedYear = String(new Date().getFullYear());

function rangeBounds(kind) {
  const now = new Date();
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (kind === "today") return [startOfDay(now), startOfDay(now)];
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
  if (kind === "selectedYear") {
    const year = Number(repSelectedYear);
    return [new Date(year, 0, 1), year === now.getFullYear() ? startOfDay(now) : new Date(year, 11, 31)];
  }
  if (kind === "custom") {
    const f = $("repFrom").value, t = $("repTo").value;
    return [f ? new Date(f) : new Date(2000, 0, 1), t ? new Date(t) : new Date()];
  }
  const firstSale = cache.sales.map((row) => row.sale_date).filter(Boolean).sort()[0];
  return [firstSale ? new Date(firstSale + "T00:00:00") : new Date(now.getFullYear(), 0, 1), startOfDay(now)]; // all
}

function wireReports() {
  $("repSales")?.addEventListener("click", () => {
    switchView("ledger");
    openLedForm(null);
  });
  const filters = $("repFilters");
  if (!filters) return;

  $("repYear")?.addEventListener("change", (event) => {
    repSelectedYear = event.target.value;
    filters.querySelectorAll(".chip-btn").forEach((x) => x.classList.remove("on"));
    repRange = repSelectedYear === "all" ? "all" : "selectedYear";
    renderReports();
  });

  filters.addEventListener("click", (e) => {
    const b = e.target.closest(".chip-btn");
    if (!b) return;
    filters.querySelectorAll(".chip-btn").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    repRange = b.dataset.range;
    if (repRange === "all") repSelectedYear = "all";
    else if (repRange === "year") repSelectedYear = String(new Date().getFullYear());
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
  const [from, to] = rangeBounds(me?.role === "staff" ? "today" : repRange);
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999);
  return {
    from,
    to: end,
    rows: cache.sales.filter((b) => {
      const d = new Date(b.sale_date + "T00:00:00");
      return d >= from && d <= end;
    }),
  };
}

function renderReports() {
  if (!$("repRange")) return;
  fillYearSelect($("repYear"));
  if (![...$("repYear").options].some((option) => option.value === repSelectedYear)) {
    repSelectedYear = availableYears()[0] || "all";
  }
  $("repYear").value = repRange === "all" ? "all" : repSelectedYear;
  const isStaffReport = me?.role === "staff";
  const { from, to, rows } = reportRows();

  $("repRange").textContent = fmtDate(from) + " — " + fmtDate(to);

  const revenue = rows.reduce((sum, row) => sum + rowTotal(row), 0);
  const expenseRows = cache.expenses.filter((row) => {
    const d = new Date(row.spend_date + "T00:00:00"); return d >= from && d <= to;
  });
  const expenses = expenseRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const profit = revenue - expenses;

  $("rRevenue").innerHTML = '<small>₮</small>' + revenue.toLocaleString("en-US");
  const compareFrom = new Date(from); compareFrom.setFullYear(compareFrom.getFullYear() - 1);
  const compareTo = new Date(to); compareTo.setFullYear(compareTo.getFullYear() - 1);
  const compareRows = isStaffReport || repRange === "all" ? [] : cache.sales.filter((row) => {
    const date = new Date(row.sale_date + "T00:00:00");
    return date >= compareFrom && date <= compareTo;
  });
  const compareRevenue = compareRows.reduce((sum, row) => sum + rowTotal(row), 0);
  const comparePct = compareRevenue ? ((revenue - compareRevenue) / compareRevenue) * 100 : null;
  $("rRevenueNote").textContent = isStaffReport
    ? `${rows.length} өнөөдрийн бүртгэл`
    : repRange === "all"
    ? rows.length + " борлуулалтын бүртгэл"
    : `${rows.length} бүртгэл · өмнөх оны мөн үеэс ${comparePct === null ? "өгөгдөлгүй" : `${comparePct >= 0 ? "+" : ""}${comparePct.toFixed(1)}%`}`;
  $("rCount").textContent = rows.length.toLocaleString("en-US");
  $("rCountNote").textContent =
    "Ажилтны оруулсан бодит гүйлгээ";
  $("rAvg").innerHTML =
    '<small>₮</small>' +
    (rows.length ? Math.round(revenue / rows.length) : 0).toLocaleString("en-US");
  const staffAmount = rows.reduce((sum, row) => sum + Number(row.therapist_amount || 0), 0);
  $("rRateLabel").textContent = isStaffReport ? "Ажилтны дүн" : "Цэвэр ашиг";
  $("rRate").innerHTML =
    '<small>₮</small>' + (isStaffReport ? staffAmount : profit).toLocaleString("en-US");
  $("rRateNote").textContent = isStaffReport
    ? "Таны борлуулалтын бүртгэлээс"
    : "Зардал " + money(expenses);

  /* daily (or monthly for long ranges) trend */
  const spanDays = Math.round((to - from) / 86400000);
  const byMonth = spanDays > 92;
  const buckets = [];
  if (byMonth) {
    const cur = new Date(from.getFullYear(), from.getMonth(), 1);
    while (cur <= to) {
      const key = cur.getFullYear() + "-" + String(cur.getMonth() + 1).padStart(2, "0");
      const v = rows.filter((b) => String(b.sale_date).slice(0, 7) === key).reduce((s, b) => s + rowTotal(b), 0);
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
      const v = rows.filter((b) => String(b.sale_date).slice(0, 10) === key).reduce((s, b) => s + rowTotal(b), 0);
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
    const key = b.services || "Тодорхойгүй";
    agg[key] = agg[key] || { n: 0, sum: 0 };
    agg[key].n++;
    agg[key].sum += rowTotal(b);
  });
  const svcBody = $("repSvcBody");
  svcBody.innerHTML = "";
  const entries = Object.entries(agg).sort((a, b) => b[1].sum - a[1].sum);
  if (!entries.length) {
    svcBody.innerHTML =
      '<tr><td colspan="4"><div class="empty">Энэ хугацаанд борлуулалт алга.</div></td></tr>';
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

  /* employee sales and attendance */
  const repStaffBody = $("repStaffBody");
  repStaffBody.innerHTML = "";
  const periodAttendance = allAttendanceRows().filter((row) => {
    const date = new Date(row.work_date + "T00:00:00");
    return date >= from && date <= to;
  });
  const assignedSaleIds = new Set();
  const staffEntries = cache.staff.map((staff) => {
    const names = [staff.name, ...(staff.aliases || [])].map((name) => String(name || "").trim().toLowerCase()).filter(Boolean);
    const staffSales = rows.filter((sale) => {
      const matches = Number(sale.staff_id) === Number(staff.id) || (!sale.staff_id && names.includes(String(sale.therapist || "").trim().toLowerCase()));
      if (matches) assignedSaleIds.add(sale.id);
      return matches;
    });
    const days = periodAttendance.filter((row) => Number(row.staff_id) === Number(staff.id) || (!row.staff_id && names.includes(String(row.staff_name || "").trim().toLowerCase()))).length;
    return { name: staff.name, count: staffSales.length, revenue: staffSales.reduce((sum, sale) => sum + rowTotal(sale), 0), days };
  }).filter((row) => row.count || row.days);
  const unassigned = rows.filter((sale) => !assignedSaleIds.has(sale.id));
  if (unassigned.length) {
    staffEntries.push({ name: "Ажилтан тодорхойгүй", count: unassigned.length, revenue: unassigned.reduce((sum, sale) => sum + rowTotal(sale), 0), days: 0 });
  }
  staffEntries.sort((a, b) => b.revenue - a.revenue);
  if (!staffEntries.length) {
    repStaffBody.innerHTML = '<tr><td colspan="5"><div class="empty">Энэ хугацаанд ажилтны үзүүлэлт алга.</div></td></tr>';
  } else {
    staffEntries.forEach((staff) => {
      const tr = document.createElement("tr");
      tr.appendChild(cell(staff.name, "t-strong"));
      tr.appendChild(cell(staff.count, "t-mono"));
      tr.appendChild(cell(money(staff.revenue), "t-mono"));
      tr.appendChild(shareCell(revenue ? (staff.revenue / revenue) * 100 : 0));
      tr.appendChild(cell(`${staff.days} өдөр`, "t-mono"));
      repStaffBody.appendChild(tr);
    });
  }

  /* status breakdown */
  const stBody = $("repStatusBody");
  stBody.innerHTML = "";
  PAYS.forEach(([k, label]) => {
    const list = rows.filter((b) => Number(b[k] || 0) > 0);
    const sum = list.reduce((s, b) => s + Number(b[k] || 0), 0);
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = "pay-chip " + k;
    pill.textContent = label;
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
    "Огноо", "Үйлчлүүлэгч", "Үйлчилгээ", "Ажилтан", "Голомт", "Хаан",
    "Бэлэн", "Нэхэмжлэх", "Barter", "Буцаалт", "Нийт", "Тэмдэглэл",
  ];
  const q = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  const lines = [head.map(q).join(",")];
  rows.forEach((b) => {
    lines.push(
      [
        b.sale_date, b.customer_name, b.services, b.therapist, b.golomt, b.khan,
        b.cash, b.invoice, b.barter, b.refund, rowTotal(b), b.note,
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
  Number(r.golomt || 0) + Number(r.khan || 0) + Number(r.cash || 0) +
  Number(r.invoice || 0) + Number(r.barter || 0) - Number(r.refund || 0);

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
  $("ledReport")?.addEventListener("click", () => switchView("reports"));
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
  cache.staff.filter((st) => st.active || Number(row?.staff_id) === Number(st.id)).forEach((st) => {
    const o = document.createElement("option");
    o.value = st.name;
    o.textContent = st.name;
    o.dataset.staffId = st.id;
    if (row && row.therapist === st.name) o.selected = true;
    sel.appendChild(o);
  });
  if (me.role === "staff") {
    const ownStaff = cache.staff.find((staff) =>
      staff.user_id === me.id ||
      String(staff.email || "").toLowerCase() === String(me.email || "").toLowerCase(),
    );
    const ownName = ownStaff?.name || me.full_name || me.email;
    if (![...sel.options].some((option) => option.value === ownName)) {
      const option = document.createElement("option");
      option.value = ownName;
      option.textContent = ownName;
      if (ownStaff) option.dataset.staffId = ownStaff.id;
      sel.appendChild(option);
    }
    sel.value = ownName;
    sel.disabled = true;
  } else {
    sel.disabled = false;
  }

  updateFormTotal();
  $("ledForm").style.display = "";
  $("ledForm").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ══════════════════════════════════════════════════════════════
   SERVICE OPERATIONS — staff, attendance, inventory
   ══════════════════════════════════════════════════════════════ */
let staffEditing = null;

function wireStaff() {
  $("staffAdd")?.addEventListener("click", () => openStaffForm());
  $("staffCancel")?.addEventListener("click", () => show($("staffForm"), false));
  $("staffSave")?.addEventListener("click", saveStaff);
}

function openStaffForm(row = null) {
  staffEditing = row;
  $("st_name").value = row?.name || "";
  $("st_title").value = row?.title || "";
  $("st_phone").value = row?.phone || "";
  $("st_email").value = row?.email || "";
  $("st_code").value = row?.employee_code || "";
  $("st_active").checked = row ? row.active !== false : true;
  show($("staffForm"));
  $("st_name").focus();
}

async function saveStaff() {
  const email = $("st_email").value.trim().toLowerCase();
  const patch = {
    name: $("st_name").value.trim(), title: $("st_title").value.trim() || null,
    phone: $("st_phone").value.trim() || null, employee_code: $("st_code").value.trim() || null,
    email: email || null, active: $("st_active").checked,
  };
  if (!patch.name) return alert("Ажилтны нэрийг оруулна уу.");
  if (patch.active && !patch.email) return alert("Ажилтны нэвтрэх и-мэйл хаягийг оруулна уу.");
  if (patch.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email)) return alert("И-мэйл хаяг буруу байна.");
  const duplicate = cache.staff.find((row) => row.id !== staffEditing?.id && row.active && String(row.email || "").toLowerCase() === patch.email);
  if (patch.email && duplicate) return alert("Энэ и-мэйл өөр ажилтанд бүртгэлтэй байна.");
  const query = staffEditing
    ? sb.from("staff").update(patch).eq("id", staffEditing.id)
    : sb.from("staff").insert({ ...patch, sort: cache.staff.length + 1 });
  const { data, error } = await query.select().maybeSingle();
  if (error) return alert("Хадгалж чадсангүй: " + error.message);
  if (staffEditing) Object.assign(staffEditing, data || patch); else if (data) cache.staff.push(data);
  show($("staffForm"), false); staffEditing = null; renderStaff();
}

function renderStaff() {
  const body = $("staffBody"); if (!body) return;
  const rows = cache.staff.filter((staff) => staff.active);
  const archived = cache.staff.length - rows.length;
  $("staffSub").textContent = `${rows.length} идэвхтэй ажилтан${archived ? ` · ${archived} архивласан` : ""}`;
  body.innerHTML = "";
  if (!rows.length) return void (body.innerHTML = '<tr><td colspan="9"><div class="empty">Идэвхтэй ажилтан бүртгэгдээгүй байна.</div></td></tr>');
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    [row.employee_code || "—", row.name, row.title || "—", row.phone || "—", row.email || "—"].forEach((value, i) => tr.appendChild(cell(value, i === 1 ? "t-strong" : "")));
    const names = [row.name, ...(row.aliases || [])].map((name) => String(name).toLowerCase());
    const workedDays = [...cache.attendance, ...cache.workdays].filter((a) => a.staff_id === row.id || (!a.staff_id && names.includes(String(a.staff_name).toLowerCase()))).length;
    const salesTotal = cache.sales.filter((s) => s.staff_id === row.id || (!s.staff_id && names.includes(String(s.therapist).toLowerCase()))).reduce((sum, sale) => sum + rowTotal(sale), 0);
    tr.appendChild(cell(`${workedDays} өдөр`, "t-mono"));
    tr.appendChild(cell(money(salesTotal), "t-mono t-strong"));
    tr.appendChild(cell(row.active ? "Идэвхтэй" : "Идэвхгүй", row.active ? "status-ok" : ""));
    const td = document.createElement("td");
    const actions = document.createElement("div"); actions.className = "row-actions";
    const edit = document.createElement("button"); edit.className = "btn-sm ghost"; edit.textContent = "Засах"; edit.onclick = () => openStaffForm(row); actions.appendChild(edit);
    if (row.active) {
      const remove = document.createElement("button"); remove.className = "btn-sm danger"; remove.textContent = "Устгах"; remove.onclick = () => removeStaff(row); actions.appendChild(remove);
    }
    td.appendChild(actions); tr.appendChild(td); body.appendChild(tr);
  });
}

async function removeStaff(row) {
  if (!confirm(`${row.name} ажилтны эрхийг цуцалж, идэвхтэй жагсаалтаас хасах уу? Өмнөх борлуулалт, ирцийн тайлан хадгалагдана.`)) return;
  const { data, error } = await sb.from("staff").update({ active: false, email: null, user_id: null }).eq("id", row.id).select().maybeSingle();
  if (error) return alert("Ажилтныг хасаж чадсангүй: " + error.message);
  Object.assign(row, data || { active: false, email: null, user_id: null });
  renderStaff();
  fillAttendanceFilters();
}

let attendanceEditing = null;

function wireAttendance() {
  $("attAdd")?.addEventListener("click", () => openAttendanceForm());
  $("attCancel")?.addEventListener("click", closeAttendanceForm);
  $("attFormCancel")?.addEventListener("click", closeAttendanceForm);
  $("attSave")?.addEventListener("click", saveAttendance);
  $("att_staff")?.addEventListener("change", (event) => {
    if (!attendanceEditing && event.target.value) $("att_day").value = nextWorkdayNumber(event.target.value);
  });
  $("attYear")?.addEventListener("change", (event) => {
    attendanceYear = event.target.value;
    renderAttendance();
  });
  $("attStaff")?.addEventListener("change", (event) => {
    attendanceStaff = event.target.value;
    renderAttendance();
  });
}

async function clockAttendance(mode) {
  const today = new Date().toISOString().slice(0, 10);
  const current = cache.attendance.find((r) => r.work_date === today && r.user_id === me.id);
  let result;
  if (mode === "in") {
    if (current) return alert("Өнөөдрийн ажил эхэлсэн цаг бүртгэгдсэн байна.");
    const priorDays = cache.attendance.filter((row) => row.user_id === me.id).length;
    result = await sb.from("attendance").insert({ work_date: today, staff_name: me.full_name || me.email, user_id: me.id, workday_number: priorDays + 1, clock_in: new Date().toISOString() }).select().maybeSingle();
  } else {
    if (!current) return alert("Эхлээд ажил эхлэх товчийг дарна уу.");
    if (current.clock_out) return alert("Ажил дууссан цаг бүртгэгдсэн байна.");
    result = await sb.from("attendance").update({ clock_out: new Date().toISOString() }).eq("id", current.id).select().maybeSingle();
  }
  if (result.error) return alert("Ирц бүртгэж чадсангүй: " + result.error.message);
  if (mode === "in" && result.data) cache.attendance.unshift(result.data); else if (result.data) Object.assign(current, result.data);
  renderAttendance();
}

function renderAttendance() {
  const body = $("attBody"); if (!body) return;
  syncAttendanceFilters();
  const today = localDateKey(new Date());
  const attendanceRows = allAttendanceRows()
    .filter((row) => String(row.work_date || "").slice(0, 10) === today)
    .sort((a, b) => String(b.work_date).localeCompare(String(a.work_date)) || Number(b.workday_number || 0) - Number(a.workday_number || 0));
  $("attSub").textContent = `${fmtDate(today)} · ${attendanceRows.length} ажилтан`;
  body.innerHTML = "";
  if (!attendanceRows.length) return void (body.innerHTML = '<tr><td colspan="5"><div class="empty">Өнөөдрийн ээлжийн мэдээлэл алга байна.</div></td></tr>');
  attendanceRows.forEach((row) => {
    const start = row.clock_in ? new Date(row.clock_in) : null, end = row.clock_out ? new Date(row.clock_out) : null;
    const tr = document.createElement("tr");
    tr.appendChild(cell(row.staff_name, "t-strong"));
    const shift = `${start?.toLocaleTimeString("mn-MN", {hour:"2-digit",minute:"2-digit"}) || "—"} — ${end?.toLocaleTimeString("mn-MN", {hour:"2-digit",minute:"2-digit"}) || "—"}`;
    tr.appendChild(cell(shift, "t-mono"));
    const statusCell = document.createElement("td");
    const status = attendanceStatus(row, end);
    const pill = document.createElement("span");
    pill.className = `pill ${status.className}`;
    pill.textContent = status.label;
    statusCell.appendChild(pill);
    tr.appendChild(statusCell);
    tr.appendChild(cell(row.note || "—"));
    const actions = document.createElement("td");
    if (isAdminUser()) {
      const edit = document.createElement("button");
      edit.className = "btn-sm ghost"; edit.textContent = "Засах";
      edit.addEventListener("click", () => openAttendanceForm(row));
      const remove = document.createElement("button");
      remove.className = "btn-sm danger"; remove.textContent = "Устгах";
      remove.addEventListener("click", () => deleteAttendance(row));
      actions.className = "row-actions";
      actions.append(edit, remove);
    }
    tr.appendChild(actions);
    body.appendChild(tr);
  });
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function attendanceStatus(row, end) {
  const note = String(row.note || "").toLowerCase();
  if (note.includes("шилжүүл")) return { label: "Өөр хүнд шилжүүлсэн", className: "st-transferred" };
  if (note.includes("гарсан") || (end && end <= new Date())) return { label: "Гарсан", className: "st-done" };
  return { label: "Ээлжтэй", className: "st-confirmed" };
}

function syncAttendanceFilters() {
  const rows = allAttendanceRows();
  const yearSelect = $("attYear");
  if (yearSelect) {
    const yearValue = attendanceYear;
    const years = [...new Set(rows.map((row) => String(row.work_date || "").slice(0, 4)).filter((year) => /^\d{4}$/.test(year)))].sort((a, b) => Number(b) - Number(a));
    yearSelect.innerHTML = '<option value="all">Бүх хугацаа</option>';
    years.forEach((year) => yearSelect.appendChild(new Option(year + " он", year)));
    attendanceYear = years.includes(yearValue) || yearValue === "all" ? yearValue : "all";
    yearSelect.value = attendanceYear;
  }

  const staffFilter = $("attStaff");
  if (staffFilter) {
    const staffValue = attendanceStaff;
    staffFilter.innerHTML = '<option value="all">Бүх ажилтан</option>';
    cache.staff.forEach((staff) => staffFilter.appendChild(new Option(staff.name, String(staff.id))));
    attendanceStaff = [...staffFilter.options].some((option) => option.value === staffValue) ? staffValue : "all";
    staffFilter.value = attendanceStaff;
  }

  const formStaff = $("att_staff");
  const selected = formStaff.value;
  formStaff.innerHTML = '<option value="">Ажилтан сонгох</option>';
  cache.staff.filter((staff) => staff.active).forEach((staff) => formStaff.appendChild(new Option(staff.name, String(staff.id))));
  if ([...formStaff.options].some((option) => option.value === selected)) formStaff.value = selected;
}

function timeInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function closeAttendanceForm() {
  attendanceEditing = null;
  show($("attForm"), false);
}

function nextWorkdayNumber(staffId) {
  const numbers = allAttendanceRows()
    .filter((row) => Number(row.staff_id) === Number(staffId))
    .map((row) => Number(row.workday_number || 0));
  return Math.max(0, ...numbers) + 1;
}

function openAttendanceForm(row = null) {
  if (!isAdminUser()) return;
  syncAttendanceFilters();
  attendanceEditing = row;
  $("attFormTitle").textContent = row ? "Ээлж, ирц засах" : "Ээлж, ирц нэмэх";
  $("att_staff").value = row?.staff_id ? String(row.staff_id) : "";
  $("att_date").value = row?.work_date || new Date().toISOString().slice(0, 10);
  $("att_day").value = row?.workday_number || "";
  $("att_in").value = timeInputValue(row?.clock_in) || "09:00";
  $("att_out").value = timeInputValue(row?.clock_out);
  $("att_note").value = row?.note || "";
  show($("attForm"));
  $("attForm").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function attendanceTimestamp(date, time) {
  return time ? new Date(`${date}T${time}:00`).toISOString() : null;
}

async function saveAttendance() {
  if (!isAdminUser()) return alert("Зөвхөн админ ээлж, ирц засах эрхтэй.");
  const staff = cache.staff.find((item) => String(item.id) === $("att_staff").value);
  const workDate = $("att_date").value;
  const workdayNumber = Number($("att_day").value);
  const clockIn = attendanceTimestamp(workDate, $("att_in").value);
  const clockOut = attendanceTimestamp(workDate, $("att_out").value);
  if (!staff || !workDate || !clockIn || workdayNumber < 1) return alert("Ажилтан, огноо, хэд дэх өдөр, эхэлсэн цагийг бөглөнө үү.");
  if (clockOut && new Date(clockOut) < new Date(clockIn)) return alert("Дууссан цаг эхэлсэн цагаас өмнө байж болохгүй.");

  const duplicate = allAttendanceRows().find((row) => Number(row.staff_id) === Number(staff.id) && row.work_date === workDate && (!attendanceEditing || row.__table !== attendanceEditing.__table || Number(row.id) !== Number(attendanceEditing.id)));
  if (duplicate) return alert("Энэ ажилтны тухайн өдрийн ирц бүртгэгдсэн байна. Одоо байгаа мөрийг засна уу.");

  const patch = {
    staff_id: staff.id,
    staff_name: staff.name,
    work_date: workDate,
    workday_number: workdayNumber,
    clock_in: clockIn,
    clock_out: clockOut,
    note: $("att_note").value.trim() || null,
  };
  const button = $("attSave"); button.disabled = true;
  let result;
  if (attendanceEditing) {
    result = await sb.from(attendanceEditing.__table).update(patch).eq("id", attendanceEditing.id).select().maybeSingle();
  } else {
    result = await sb.from("attendance").insert({ ...patch, user_id: null }).select().maybeSingle();
  }
  button.disabled = false;
  if (result.error) return alert("Ирц хадгалж чадсангүй: " + result.error.message);

  if (attendanceEditing) {
    const bucket = attendanceEditing.__table === "staff_workdays" ? cache.workdays : cache.attendance;
    const current = bucket.find((row) => Number(row.id) === Number(attendanceEditing.id));
    if (current) Object.assign(current, result.data || patch);
  } else if (result.data) {
    cache.attendance.unshift(result.data);
  }
  closeAttendanceForm();
  renderAttendance();
  renderOverview();
}

async function deleteAttendance(row) {
  if (!isAdminUser()) return alert("Зөвхөн админ ирц устгах эрхтэй.");
  if (!confirm(`${row.work_date} өдрийн ${row.staff_name} ажилтны ирцийг устгах уу? Энэ үйлдлийг буцаах боломжгүй.`)) return;
  const { error } = await sb.from(row.__table).delete().eq("id", row.id);
  if (error) return alert("Ирц устгаж чадсангүй: " + error.message);
  if (row.__table === "staff_workdays") cache.workdays = cache.workdays.filter((item) => Number(item.id) !== Number(row.id));
  else cache.attendance = cache.attendance.filter((item) => Number(item.id) !== Number(row.id));
  renderAttendance();
  renderOverview();
}

function wireInventory() {
  $("invAdd")?.addEventListener("click", () => show($("invForm")));
  $("invCancel")?.addEventListener("click", () => show($("invForm"), false));
  $("invSave")?.addEventListener("click", saveInventory);
}

async function saveInventory() {
  const patch = { name: $("i_name").value.trim(), category: $("i_category").value.trim() || null, unit: $("i_unit").value.trim() || "ш", quantity: Number($("i_qty").value) || 0, min_quantity: Number($("i_min").value) || 0, unit_cost: Number($("i_cost").value) || 0 };
  if (!patch.name) return alert("Материалын нэрийг оруулна уу.");
  const { data, error } = await sb.from("inventory_items").insert(patch).select().maybeSingle();
  if (error) return alert("Хадгалж чадсангүй: " + error.message);
  if (data) cache.inventory.push(data); show($("invForm"), false); renderInventory();
}

function renderInventory() {
  const body = $("invBody"); if (!body) return;
  const low = cache.inventory.filter((r) => Number(r.quantity) <= Number(r.min_quantity)).length;
  $("invSub").textContent = `${cache.inventory.length} нэр төрөл${low ? ` · ${low} нөхөх шаардлагатай` : ""}`;
  body.innerHTML = "";
  if (!cache.inventory.length) return void (body.innerHTML = '<tr><td colspan="6"><div class="empty">Материал бүртгэгдээгүй байна.</div></td></tr>');
  cache.inventory.forEach((row) => {
    const isLow = Number(row.quantity) <= Number(row.min_quantity); const tr = document.createElement("tr");
    [row.name, row.category || "—", `${row.quantity} ${row.unit}`, `${row.min_quantity} ${row.unit}`, money(row.unit_cost), isLow ? "Нөхөх" : "Хэвийн"].forEach((v, i) => tr.appendChild(cell(v, i === 0 ? "t-strong" : isLow && i === 5 ? "status-low" : ""))); body.appendChild(tr);
  });
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
    staff_id: Number($("f_staff").selectedOptions[0]?.dataset.staffId) || null,
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
    if (isAdminUser() || r.created_by === me?.id) {
      const ed = document.createElement("button");
      ed.className = "btn-sm ghost";
      ed.textContent = "Засах";
      ed.addEventListener("click", () => openLedForm(r));
      act.appendChild(ed);
    }
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


/* ══════════════════════════════════════════════════════════════
   FILE IMPORT — drop an Excel / CSV / Word file, map it, load it

   Columns are matched by their heading, so a sheet laid out like the
   tracking workbook needs no configuration; anything unusual can be
   remapped by hand before the rows go in.
   ══════════════════════════════════════════════════════════════ */

/* our field ← headings that mean it */
const IMPORT_FIELDS = [
  ["sale_date",     "Огноо",             ["он сар өдөр", "он сар", "огноо", "date", "он"]],
  ["customer_name", "Үйлчлүүлэгч",       ["нэрс", "харилцагчийн нэр", "харилцагч", "нэр", "customer", "name"]],
  ["services",      "Үйлчилгээ",         ["үйлчилгээ", "service", "services"]],
  ["golomt",        "Голомт",            ["голомт", "golomt"]],
  ["khan",          "Хаан",              ["хаан", "khan", "khaan"]],
  ["cash",          "Бэлэн",             ["бэлэн", "cash", "бэлнээр"]],
  ["invoice",       "Нэхэмжлэх",         ["нэхэмжлэх", "invoice"]],
  ["barter",        "Barter",            ["barter", "бартер"]],
  ["refund",        "Буцаалт",           ["буцаалт", "refund", "буцаах"]],
  ["total_amount",  "Нийт дүн",          ["total income", "нийт төлбөр", "нийт дүн", "дүн", "төлбөр", "total", "amount"]],
  ["cryo_cabin",    "Cryo Cabin",        ["cryo cabin", "cryocabin", "cabin", "крио кабин"]],
  ["oxy_pro",       "Oxy Pro",           ["oxy pro", "oxypro"]],
  ["led_pro",       "Led Pro",           ["led pro", "ledpro"]],
  ["x_cryo",        "X°Cryo",            ["x cryo", "xcryo", "x°cryo"]],
  ["zerobody",      "Zerobody",          ["zerobody", "zero body"]],
  ["normatec",      "Normatec",          ["normatec"]],
  ["oxygen",        "Oxygen",            ["oxygen", "хүчилтөрөгч"]],
  ["therapist",     "Ажилтан",           ["ажилтан", "therapist", "эмч", "staff"]],
  ["gift_card",     "Gift card",         ["gift card", "giftcard", "бэлгийн карт"]],
  ["note",          "Тэмдэглэл",         ["тэмдэглэл", "notes", "note", "тайлбар"]],
];
const MONEY_FIELDS = ["golomt", "khan", "cash", "invoice", "barter", "refund", "gift_card"];
const COUNT_FIELDS = ["cryo_cabin", "oxy_pro", "led_pro", "x_cryo", "zerobody", "normatec", "oxygen"];

let imp = null; // { sheets, sheetIdx, headerRow, map, year }

/* ── loaders, fetched only when the panel is first used ── */
let XLSXlib = null;
async function loadXLSX() {
  if (!XLSXlib) XLSXlib = await import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");
  return XLSXlib;
}
let JSZiplib = null;
async function loadZip() {
  if (!JSZiplib) {
    const m = await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm");
    JSZiplib = m.default || m;
  }
  return JSZiplib;
}

const impNorm = (v) => String(v || "").toLowerCase().replace(/\s+/g, " ").trim();

function impNum(v) {
  if (v == null) return 0;
  const match = String(v).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  const n = match ? Number(match[0]) : NaN;
  return isNaN(n) ? 0 : Math.round(n);
}

/* same calendar rules the workbook importer uses */
function impYmd(y, mo, d) {
  if (!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}
function impPair(a, b, year) {
  if (a > 12 && b <= 12) return impYmd(year, b, a); // a over 12 can only be a day
  return impYmd(year, a, b);
}
function impDate(v, year) {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v))
    return impYmd(v.getFullYear(), v.getMonth() + 1, v.getDate());
  const t = String(v).trim().replace(/[\/.]{2,}/g, "/");
  let m = t.match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/);
  if (m) return impYmd(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m) return impPair(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[\/.-](\d{1,2})$/);
  if (m) return impPair(+m[1], +m[2], year);
  return null;
}

/* ── wiring ── */
function wireImport() {
  if (!$("impPanel")) return;
  $("ledImport").addEventListener("click", () => {
    $("impPanel").style.display = "";
    $("ledForm").style.display = "none";
    $("impPanel").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  const close = () => {
    $("impPanel").style.display = "none";
    $("impSetup").style.display = "none";
    $("impStatus").innerHTML = "";
    $("impFile").value = "";
    imp = null;
  };
  $("impClose").addEventListener("click", close);
  $("impCancel").addEventListener("click", close);

  const drop = $("impDrop");
  $("impFile").addEventListener("change", (e) => {
    if (e.target.files[0]) readImportFile(e.target.files[0]);
  });
  ["dragenter", "dragover"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("over");
    }),
  );
  ["dragleave", "drop"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove("over");
    }),
  );
  drop.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files[0];
    if (f) readImportFile(f);
  });

  ["impSheet", "impHeader", "impYear", "impTotalTo"].forEach((id) =>
    $(id).addEventListener("change", () => {
      if (id === "impSheet") imp.headerRow = null;
      renderImportSetup();
    }),
  );
  $("impRun").addEventListener("click", runImport);
}

function impSay(kind, html) {
  $("impStatus").innerHTML = '<div class="notice ' + kind + '">' + html + "</div>";
}

/* ── read a file into { name, rows[][], formulaRows:Set } per sheet ── */
async function readImportFile(file) {
  impSay("warn", "Уншиж байна…");
  try {
    const buf = await file.arrayBuffer();
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    let sheets;

    if (ext === "docx") {
      sheets = await readDocxTables(buf);
      if (!sheets.length) {
        impSay("err", "Word файлаас хүснэгт олдсонгүй. Өгөгдөл хүснэгт хэлбэртэй байх шаардлагатай.");
        return;
      }
    } else {
      const XLSX = await loadXLSX();
      const wb = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: true, cellFormula: true });
      sheets = wb.SheetNames.map((n) => {
        const ws = wb.Sheets[n];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
        /* a SUM in a row means a subtotal, not a sale */
        const formulaRows = new Set();
        Object.keys(ws).forEach((addr) => {
          if (addr[0] === "!") return;
          if (ws[addr] && ws[addr].f) formulaRows.add(XLSX.utils.decode_cell(addr).r);
        });
        return { name: n, rows, formulaRows };
      });
    }

    sheets = sheets.filter((sh) => sh.rows.some((r) => r && r.some((c) => c != null && String(c).trim() !== "")));
    if (!sheets.length) {
      impSay("err", "Файл хоосон байна.");
      return;
    }

    imp = { sheets, sheetIdx: 0, headerRow: null, map: {}, fileName: file.name };
    $("impYear").value = new Date().getFullYear();

    const sel = $("impSheet");
    sel.innerHTML = "";
    sheets.forEach((sh, i) => {
      const o = document.createElement("option");
      o.value = i;
      o.textContent = sh.name;
      sel.appendChild(o);
    });

    impSay("ok", "<b>" + file.name + "</b> уншигдлаа · " + sheets.length + " хуудас");
    $("impSetup").style.display = "";
    renderImportSetup();
  } catch (e) {
    impSay("err", "Уншиж чадсангүй: " + (e.message || e));
  }
}

/* Word tables: docx is a zip, the tables live in word/document.xml */
async function readDocxTables(buf) {
  const JSZip = await loadZip();
  const zip = await JSZip.loadAsync(buf);
  const f = zip.file("word/document.xml");
  if (!f) return [];
  const xml = await f.async("string");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const tables = [...doc.getElementsByTagName("w:tbl")];
  return tables.map((tbl, i) => {
    const rows = [...tbl.getElementsByTagName("w:tr")].map((tr) =>
      [...tr.getElementsByTagName("w:tc")].map((tc) =>
        [...tc.getElementsByTagName("w:t")].map((t) => t.textContent).join("").trim() || null,
      ),
    );
    return { name: "Хүснэгт " + (i + 1), rows, formulaRows: new Set() };
  });
}

/* ── guess the header row and the column mapping ── */
function guessHeaderRow(rows) {
  let best = 0,
    bestScore = -1;
  rows.slice(0, 15).forEach((r, i) => {
    if (!r) return;
    let score = 0;
    r.forEach((c) => {
      const v = impNorm(c);
      if (!v) return;
      IMPORT_FIELDS.forEach(([, , aliases]) => {
        if (aliases.some((a) => v === a || v.includes(a))) score++;
      });
    });
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return bestScore > 0 ? best : 0;
}

function guessMap(header) {
  const map = {};
  const taken = new Set();
  IMPORT_FIELDS.forEach(([field, , aliases]) => {
    let hit = -1;
    header.forEach((c, i) => {
      if (hit >= 0 || taken.has(i)) return;
      const v = impNorm(c);
      if (!v) return;
      if (aliases.some((a) => v === a)) hit = i;
    });
    if (hit < 0)
      header.forEach((c, i) => {
        if (hit >= 0 || taken.has(i)) return;
        const v = impNorm(c);
        if (!v) return;
        if (aliases.some((a) => v.includes(a))) hit = i;
      });
    if (hit >= 0) {
      map[field] = hit;
      taken.add(hit);
    }
  });
  return map;
}

function renderImportSetup() {
  if (!imp) return;
  imp.sheetIdx = +$("impSheet").value || 0;
  const sh = imp.sheets[imp.sheetIdx];

  const hSel = $("impHeader");
  if (imp.headerRow == null) {
    imp.headerRow = guessHeaderRow(sh.rows);
    hSel.innerHTML = "";
    sh.rows.slice(0, 15).forEach((r, i) => {
      const o = document.createElement("option");
      o.value = i;
      o.textContent =
        "Мөр " + (i + 1) + ": " + (r || []).filter(Boolean).slice(0, 4).join(" · ").slice(0, 60);
      hSel.appendChild(o);
    });
    hSel.value = imp.headerRow;
    imp.map = guessMap(sh.rows[imp.headerRow] || []);
  } else {
    imp.headerRow = +hSel.value || 0;
    imp.map = guessMap(sh.rows[imp.headerRow] || []);
  }

  const header = sh.rows[imp.headerRow] || [];

  /* mapping controls */
  const grid = $("impMap");
  grid.innerHTML = "";
  IMPORT_FIELDS.forEach(([field, label]) => {
    const wrap = document.createElement("div");
    wrap.className = "map-row";
    const l = document.createElement("label");
    l.textContent = label;
    const sel = document.createElement("select");
    sel.className = "ctl sm";
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "—";
    sel.appendChild(none);
    header.forEach((c, i) => {
      const o = document.createElement("option");
      o.value = i;
      o.textContent = (String(c || "").trim() || "Багана " + (i + 1)).slice(0, 34);
      if (imp.map[field] === i) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", () => {
      if (sel.value === "") delete imp.map[field];
      else imp.map[field] = +sel.value;
      renderImportPreview();
    });
    if (imp.map[field] != null) wrap.classList.add("matched");
    wrap.append(l, sel);
    grid.appendChild(wrap);
  });

  renderImportPreview();
}

/* ── turn the sheet into sales rows using the current mapping ── */
function buildImportRows() {
  const sh = imp.sheets[imp.sheetIdx];
  const year = +$("impYear").value || new Date().getFullYear();
  const totalTo = $("impTotalTo").value;
  const get = (r, f) => (imp.map[f] == null ? null : r[imp.map[f]]);

  const out = [];
  let skippedSubtotal = 0,
    skippedEmpty = 0,
    lastDate = null;

  sh.rows.forEach((r, i) => {
    if (i <= imp.headerRow || !r) return;

    const d = impDate(get(r, "sale_date"), year);
    if (d) lastDate = d;

    const name = String(get(r, "customer_name") || "").trim();
    if (/^Нэрс$/i.test(name) || /^Total:$/i.test(name)) return;
    const row = {
      sale_date: lastDate,
      customer_name: name || null,
      services: String(get(r, "services") || "").trim() || null,
      note: String(get(r, "note") || "").trim() || null,
      therapist: String(get(r, "therapist") || "").trim() || null,
      golomt: 0, khan: 0, cash: 0, invoice: 0, barter: 0, refund: 0, gift_card: 0,
      cryo_cabin: 0, oxy_pro: 0, led_pro: 0, x_cryo: 0, zerobody: 0, normatec: 0, oxygen: 0,
      therapist_amount: 0,
      needs_review: !name,
      source: "import",
    };
    MONEY_FIELDS.forEach((f) => {
      if (imp.map[f] != null) row[f] = impNum(r[imp.map[f]]);
    });
    COUNT_FIELDS.forEach((f) => {
      if (imp.map[f] != null) row[f] = Math.max(0, Math.min(99, impNum(r[imp.map[f]])));
    });
    /* a single total column goes to whichever method they picked */
    if (imp.map.total_amount != null) {
      const t = impNum(r[imp.map.total_amount]);
      const split = MONEY_FIELDS.some((f) => f !== "gift_card" && row[f]);
      if (t && !split) row[totalTo] = t;
    }

    const money = row.golomt + row.khan + row.cash + row.invoice + row.barter - row.refund;
    const devices = COUNT_FIELDS.reduce((a, f) => a + row[f], 0);

    if (!row.sale_date) return void skippedEmpty++;
    if (!name && !money && !devices) return void skippedEmpty++;
    if (sh.formulaRows.has(i)) return void skippedSubtotal++;

    row._total = money;
    out.push(row);
  });

  return { rows: out, skippedSubtotal, skippedEmpty };
}

function renderImportPreview() {
  if (!imp) return;
  const { rows, skippedSubtotal, skippedEmpty } = buildImportRows();

  const cols = ["sale_date", "customer_name", "services", "therapist"];
  const tbl = $("impPreview");
  tbl.innerHTML = "";
  const thead = document.createElement("thead");
  const htr = document.createElement("tr");
  ["Огноо", "Үйлчлүүлэгч", "Үйлчилгээ", "Ажилтан", "Төхөөрөмж", "Дүн"].forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  tbl.appendChild(thead);
  const tb = document.createElement("tbody");
  rows.slice(0, 6).forEach((r) => {
    const tr = document.createElement("tr");
    cols.forEach((c) => tr.appendChild(cell(r[c] || "—")));
    tr.appendChild(cell(COUNT_FIELDS.reduce((a, f) => a + r[f], 0) || "—", "t-mono"));
    tr.appendChild(cell(money(r._total), "t-mono t-strong"));
    tb.appendChild(tr);
  });
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.innerHTML = '<div class="empty">Тохирох мөр олдсонгүй. Толгой мөр, багануудаа шалгана уу.</div>';
    tr.appendChild(td);
    tb.appendChild(tr);
  }
  tbl.appendChild(tb);

  const total = rows.reduce((a, r) => a + r._total, 0);
  const flagged = rows.filter((r) => r.needs_review).length;
  $("impSummary").innerHTML =
    '<div class="notice ' + (rows.length ? "ok" : "warn") + '">' +
    "<b>" + rows.length + " мөр</b> · нийт " + money(total) +
    (skippedSubtotal ? " · " + skippedSubtotal + " дэд дүнгийн мөр алгасав" : "") +
    (skippedEmpty ? " · " + skippedEmpty + " хоосон мөр алгасав" : "") +
    (flagged ? " · " + flagged + " нэргүй (тэмдэглэгдэнэ)" : "") +
    "</div>";
  $("impRun").disabled = !rows.length;
}

async function runImport() {
  const btn = $("impRun");
  const { rows } = buildImportRows();
  if (!rows.length) return;
  if (!confirm(rows.length + " мөр нэмэх үү?")) return;

  btn.disabled = true;
  const clean = rows.map((r) => {
    const c = { ...r };
    delete c._total;
    const employee = cache.staff.find((staff) =>
      [staff.name, ...(staff.aliases || [])].some((name) => impNorm(name) === impNorm(c.therapist)),
    );
    c.staff_id = employee?.id || null;
    return c;
  });

  let done = 0;
  for (let i = 0; i < clean.length; i += 200) {
    const chunk = clean.slice(i, i + 200);
    const { data, error } = await sb.from("sales").insert(chunk).select();
    if (error) {
      btn.disabled = false;
      impSay("err", done + " мөр орсны дараа алдаа гарлаа: " + error.message);
      if (done) {
        await loadAll();
      }
      return;
    }
    done += chunk.length;
    if (data) cache.sales.unshift(...data);
    impSay("warn", done + " / " + clean.length + " мөр орлоо…");
  }

  btn.disabled = false;
  impSay("ok", "<b>" + done + " мөр амжилттай орлоо.</b>");
  renderLedger();
  renderReports();
  setTimeout(() => {
    $("impPanel").style.display = "none";
    $("impSetup").style.display = "none";
    $("impFile").value = "";
    imp = null;
  }, 1800);
}
