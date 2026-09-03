/* ══════════════════════════════════════════════════════════════
   Turns "CRYO Mongolia борлуулалт хөтлөлт.xlsx" into SQL you can
   paste into the Supabase SQL editor.

     npm i xlsx
     node scripts/import-workbook.mjs "E:/download/CRYO Mongolia борлуулалт хөтлөлт.xlsx"

   Writes supabase/import-sales.sql.

   What it does and does not take:
   · "<year> Income"    → one sales row per transaction, money split by method
   · "CryoStart <year>" → device sessions + therapist, matched onto those rows
                          by date + customer name
   · "Зардал"           → expenses
   · Rows whose money cells are SUM formulas are subtotals, not sales,
     and are skipped — including them double-counts revenue.
   · A money row with no customer name is imported with needs_review = true
     rather than dropped, so nothing disappears silently.
   ══════════════════════════════════════════════════════════════ */

import XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FILE = process.argv[2];
if (!FILE) {
  console.error("usage: node scripts/import-workbook.mjs <workbook.xlsx>");
  process.exit(1);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "supabase", "import-sales.sql");

const wb = XLSX.readFile(FILE, { cellDates: true });
const grid = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null, raw: false });

const num = (v) => {
  if (v == null) return 0;
  const match = String(v).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  const n = match ? Number(match[0]) : NaN;
  return isNaN(n) ? 0 : Math.round(n);
};
const q = (v) =>
  v == null || String(v).trim() === "" ? "null" : "'" + String(v).trim().replace(/'/g, "''") + "'";
const norm = (s) =>
  String(s || "").toLowerCase().replace(/[^a-zа-яөүё0-9]+/gi, " ").trim();

/* The sheets mix conventions in the same column: "6/8/2025" is
   month/day but "14/9/2025" is day/month, and some cells double the
   separator ("12//21"). Anything that cannot be resolved to a real
   calendar date is skipped rather than guessed at. */
function ymd(y, mo, d) {
  if (!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null; // e.g. 2/30
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function pair(a, b, year) {
  /* a value over 12 can only be the day */
  if (a > 12 && b <= 12) return ymd(year, b, a);
  return ymd(year, a, b);
}

function toDate(v, year) {
  if (!v) return null;
  const s = String(v).trim().replace(/[\/.]{2,}/g, "/");

  let m = s.match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/); // 2026.01.02
  if (m) return ymd(+m[1], +m[2], +m[3]);

  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/); // 6/8/2025 or 14/9/2025
  if (m) return pair(+m[1], +m[2], +m[3]);

  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})$/); // 1/2 — year comes from the sheet
  if (m) return pair(+m[1], +m[2], year);

  return null;
}

/* ── visits: device counts + therapist ── */
function readVisits(sheet, year) {
  if (!wb.Sheets[sheet]) return [];
  const rows = grid(sheet);
  const H = (rows[0] || []).map((c) => String(c || "").trim());
  const f = (re) => H.findIndex((c) => re.test(c));
  const col = {
    date: f(/он сар/i),
    cabin: f(/cryo\s*cabin/i),
    oxy: f(/oxy\s*pro/i),
    led: f(/led\s*pro/i),
    xcryo: f(/x\s*cryo/i),
    zero: f(/zerobody/i),
    norma: f(/normatec/i),
    oxygen: f(/^oxygen/i),
    device: f(/tuhuurumj/i),
    gift: f(/gift card/i),
    total: f(/total income|нийт төлбөр/i),
    notes: f(/^notes/i),
    internal: f(/дотоод/i),
  };
  const from = col.device >= 0 ? col.device + 1 : col.oxygen + 1;
  const to = col.gift >= 0 ? col.gift : col.total;
  const staff = [];
  for (let i = from; i < to; i++) if (H[i]) staff.push({ name: H[i], i });

  const out = [];
  let last = null;
  rows.slice(1).forEach((r) => {
    if (!r) return;
    const d = toDate(r[col.date], year);
    if (d) last = d;
    const name = String(r[1] || "").trim();
    if (!name || !last) return;
    let who = null,
      amt = 0;
    staff.forEach((s) => {
      const v = num(r[s.i]);
      if (v > amt) {
        amt = v;
        who = s.name;
      }
    });
    out.push({
      date: last,
      key: last + "|" + norm(name).slice(0, 14),
      cabin: num(r[col.cabin]), oxy: num(r[col.oxy]), led: num(r[col.led]),
      xcryo: num(r[col.xcryo]), zero: num(r[col.zero]), norma: num(r[col.norma]),
      oxygen: num(r[col.oxygen]),
      therapist: who, therapist_amount: amt,
      gift: num(r[col.gift]),
      notes: String(r[col.notes] || "").trim(),
      internal: String(r[col.internal] || "").trim() !== "",
    });
  });
  return out;
}

/* ── income: the money ── */
function readIncome(sheet, year, visits) {
  if (!wb.Sheets[sheet]) return { rows: [], skipped: 0, unnamed: 0, matched: 0 };
  const ws = wb.Sheets[sheet];
  const rows = grid(sheet);
  const h = rows.findIndex((r) => r && r.some((c) => String(c || "").includes("Нэрс")));
  if (h < 0) return { rows: [], skipped: 0, unnamed: 0, matched: 0 };
  const H = rows[h].map((c) => String(c || "").trim());
  const idx = (n) => H.findIndex((c) => c.replace(/^\s+/, "") === n);
  const col = {
    date: H.findIndex((c) => c.includes("Он сар")),
    name: idx("Нэрс"), svc: idx("Үйлчилгээ"),
    golomt: idx("Голомт"), khan: idx("Хаан"), cash: idx("Бэлэн"),
    invoice: idx("Нэхэмжлэх"), refund: idx("Буцаалт"), barter: idx("Barter"),
  };
  const moneyCols = [col.golomt, col.khan, col.cash, col.invoice, col.refund, col.barter].filter((c) => c >= 0);
  /* older sheets split money as Төлбөр / Банк / Төлбөрийн хэлбэр; importing
     them with this mapping would produce hundreds of zero-value rows */
  if (col.golomt < 0 && col.khan < 0) return { rows: [], skipped: 0, unnamed: 0, matched: 0 };

  const pool = new Map();
  visits.forEach((v) => {
    if (!pool.has(v.key)) pool.set(v.key, []);
    pool.get(v.key).push(v);
  });

  const out = [];
  let last = null, skipped = 0, unnamed = 0, matched = 0;

  rows.slice(h + 1).forEach((r, k) => {
    if (!r) return;
    const excelRow = h + 2 + k;
    const d = toDate(r[col.date], year);
    if (d) last = d;

    const money = {
      golomt: num(r[col.golomt]), khan: num(r[col.khan]), cash: num(r[col.cash]),
      invoice: num(r[col.invoice]), refund: num(r[col.refund]), barter: num(r[col.barter]),
    };
    const total = money.golomt + money.khan + money.cash + money.invoice + money.barter - money.refund;
    const name = String(r[col.name] || "").trim();
    if (/^Нэрс$/i.test(name) || /^Total:$/i.test(name)) return;
    if (total === 0 && !name) return;
    if (!last) return;

    /* a SUM in a money cell means this is a subtotal line, not a sale */
    const isSubtotal = moneyCols.some((c) => {
      const cell = ws[XLSX.utils.encode_cell({ r: excelRow - 1, c })];
      return cell && cell.f;
    });
    if (isSubtotal) {
      skipped++;
      return;
    }

    const row = {
      date: last, name, services: String(r[col.svc] || "").trim(), ...money,
      cabin: 0, oxy: 0, led: 0, xcryo: 0, zero: 0, norma: 0, oxygen: 0,
      therapist: null, therapist_amount: 0, gift: 0, internal: false, notes: "",
      needs_review: !name,
    };
    if (!name) unnamed++;

    const arr = pool.get(last + "|" + norm(name).slice(0, 14));
    if (arr && arr.length) {
      const v = arr.shift();
      Object.assign(row, {
        cabin: v.cabin, oxy: v.oxy, led: v.led, xcryo: v.xcryo, zero: v.zero,
        norma: v.norma, oxygen: v.oxygen, therapist: v.therapist,
        therapist_amount: v.therapist_amount, gift: v.gift,
        internal: v.internal, notes: v.notes,
      });
      matched++;
    }
    out.push(row);
  });

  return { rows: out, skipped, unnamed, matched };
}

/* ── expenses ── */
function readExpenses() {
  if (!wb.Sheets["Зардал"]) return [];
  const rows = grid("Зардал");
  const h = rows.findIndex((r) => r && r.some((c) => String(c || "").includes("Юунд")));
  if (h < 0) return [];
  const H = rows[h].map((c) => String(c || "").trim());
  /* the labels sit one column left of their values:
     Хэнээс→item, Zarlaga→qty, Юунд→unit price, Хэн→amount, Үлдэгдэл→paid with */
  const col = {
    date: H.findIndex((c) => c.includes("Он сар")),
    item: H.indexOf("Хэнээс"),
    qty: H.indexOf("Zarlaga"),
    amount: H.indexOf("Хэн"),
    paidWith: H.indexOf("Үлдэгдэл"),
    note: H.indexOf("Тэмдэглэл"),
  };
  const out = [];
  rows.slice(h + 1).forEach((r) => {
    if (!r) return;
    const d = toDate(r[col.date], 2025);
    const item = String(r[col.item] || "").trim();
    const amount = num(r[col.amount]);
    if (!d || (!item && !amount)) return;
    out.push({
      date: d, item: item || "—", qty: num(r[col.qty]) || null, amount,
      paid_with: String(r[col.paidWith] || "").trim(),
      note: String(r[col.note] || "").trim(),
    });
  });
  return out;
}

/* ── build the SQL ── */
const years = [];
for (const name of wb.SheetNames) {
  const m = name.match(/(\d{4})\s*Income/);
  if (m) years.push({ income: name, year: +m[1] });
}

const chunks = [];
let grand = 0, grandRows = 0;
const report = [];

for (const { income, year } of years) {
  const visitSheet = wb.SheetNames.find((n) => n.trim() === `CryoStart ${year}`);
  const visits = visitSheet ? readVisits(visitSheet, year) : [];
  const res = readIncome(income, year, visits);
  if (!res.rows.length) {
    report.push(
      `${income}: skipped — splits money as Төлбөр/Банк, not one column per bank`,
    );
    continue;
  }
  const sum = res.rows.reduce(
    (s, r) => s + r.golomt + r.khan + r.cash + r.invoice + r.barter - r.refund, 0);
  grand += sum;
  grandRows += res.rows.length;
  report.push(
    `${income}: ${res.rows.length} sales · ₮${sum.toLocaleString("en-US")} · ` +
      `${res.matched} matched to ${visitSheet || "—"} · ${res.skipped} subtotal rows skipped · ` +
      `${res.unnamed} without a name (flagged)`,
  );

  const values = res.rows.map(
    (r) =>
      `(${q(r.date)},${q(r.name)},${q(r.services)},${r.golomt},${r.khan},${r.cash},${r.invoice},` +
      `${r.barter},${r.refund},${r.cabin},${r.oxy},${r.led},${r.xcryo},${r.zero},${r.norma},` +
      `${r.oxygen},${q(r.therapist)},${r.therapist_amount},${r.gift},${r.internal},` +
      `${r.needs_review},${q(r.notes)},'import')`,
  );

  chunks.push(`-- ── ${income} ──`);
  for (let i = 0; i < values.length; i += 200) {
    chunks.push(
      "insert into public.sales (sale_date,customer_name,services,golomt,khan,cash,invoice,barter,refund," +
        "cryo_cabin,oxy_pro,led_pro,x_cryo,zerobody,normatec,oxygen,therapist,therapist_amount,gift_card," +
        "is_internal,needs_review,note,source) values\n" +
        values.slice(i, i + 200).join(",\n") +
        ";",
    );
  }
}

const exp = readExpenses();
if (exp.length) {
  const expSum = exp.reduce((s, r) => s + r.amount, 0);
  report.push(`Зардал: ${exp.length} expenses · ₮${expSum.toLocaleString("en-US")}`);
  const values = exp.map(
    (r) => `(${q(r.date)},${q(r.item)},${r.qty ?? "null"},${r.amount},${q(r.paid_with)},${q(r.note)},'import')`,
  );
  chunks.push("-- ── Зардал ──");
  for (let i = 0; i < values.length; i += 200) {
    chunks.push(
      "insert into public.expenses (spend_date,item,qty,amount,paid_with,note,source) values\n" +
        values.slice(i, i + 200).join(",\n") +
        ";",
    );
  }
}

const header = `-- ═══════════════════════════════════════════════════════════════
--  °CRYO Mongolia — imported from the sales workbook
--  Generated ${new Date().toISOString().slice(0, 10)} by scripts/import-workbook.mjs
--
${report.map((l) => "--  " + l).join("\n")}
--
--  Total imported: ${grandRows} sales · ₮${grand.toLocaleString("en-US")}
--
--  Run setup.sql first, then paste this in.
--  Safe to re-run: it clears the previous import first and leaves
--  anything you typed by hand (source = 'manual') untouched.
-- ═══════════════════════════════════════════════════════════════

-- self-sufficient: works even if this file is run before setup.sql,
-- or against tables created by an earlier version of it
alter table public.sales    add column if not exists source text not null default 'manual';
alter table public.expenses add column if not exists source text not null default 'manual';

delete from public.sales    where source = 'import';
delete from public.expenses where source = 'import';

`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, header + chunks.join("\n\n") + "\n");

console.log(report.join("\n"));
console.log(`\nTotal: ${grandRows} sales · ₮${grand.toLocaleString("en-US")}`);
console.log("wrote " + OUT);
