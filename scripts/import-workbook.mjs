/* ══════════════════════════════════════════════════════════════
   Turns "CRYO Mongolia борлуулалт хөтлөлт.xlsx" into SQL you can
   paste into the Supabase SQL editor.

     npm i xlsx
     node scripts/import-workbook.mjs "E:/download/CRYO Mongolia борлуулалт хөтлөлт.xlsx"

   Writes supabase/local/import-sales.sql — gitignored, because the SQL
   carries customer names and phone numbers and the repository is public.

   What it does and does not take:
   · "<year> Income"    → one sales row per transaction, money split by method.
                          2026 is one table; 2025 is a month-per-block sheet
                          whose columns change through the year, so it is read
                          block by block.
   · "CryoStart <year>" → device sessions + therapist, matched onto those rows
                          by date + customer name
   · "Зардал"           → expenses
   · "Утасны жагсаалт"  → customers (the table demands an 8-digit phone, so
                          names recorded without one cannot be carried over)
   · Service names seen in the Income sheets → services, kept inactive so the
                          public price list is not touched
   · Rows whose money cells are SUM formulas are subtotals, not sales,
     and are skipped — including them double-counts revenue.
   · A money row with no customer name is imported with needs_review = true
     rather than dropped, so nothing disappears silently.
   ══════════════════════════════════════════════════════════════ */

import XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeParts } from "./sql-parts.mjs";

const FILE = process.argv[2];
if (!FILE) {
  console.error("usage: node scripts/import-workbook.mjs <workbook.xlsx>");
  process.exit(1);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/* supabase/local/ is gitignored — this SQL carries customer names and
   phone numbers, and the repository is public */
const OUT = path.join(root, "supabase", "local", "import-sales.sql");

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

/* ── income, block layout ──────────────────────────────────────
   The 2025 sheet is not one table. Each month is its own block, blocks
   sit side by side, and the columns change as the year goes on: the
   early months carry a single Төлбөр column routed by a Банк name, the
   later ones split the money one column per bank the way 2026 does.
   So instead of one header row, find every "Нэрс" heading and read the
   block that hangs under it.                                        */

const MONEY_LABELS = [
  [/^голомт$|^golomt$/i, "golomt"],
  [/^хаан$|^khan$/i, "khan"],
  [/^бэлэн$|^cash$/i, "cash"],
  [/^нэхэмжлэх$|^invoices?$/i, "invoice"],
  [/^barter$/i, "barter"],
  [/^буцаалт$|^refund$/i, "refund"],
];
/* staff paid for their own sessions out of wages — no bank moved, so it
   lands in barter and says so in the note rather than inflating cash */
const PAYROLL = /tsaling|цалингаас/i;

function findBlocks(rows) {
  const heads = [];
  rows.forEach((row, h) => {
    if (!row) return;
    row.forEach((cell, c) => {
      if (String(cell || "").trim() === "Нэрс") heads.push({ h, c });
    });
  });

  return heads.map((head) => {
    const H = rows[head.h];
    let a = head.c;
    while (a > 0 && String(H[a - 1] || "").trim()) a--;
    let b = head.c;
    while (b + 1 < H.length && String(H[b + 1] || "").trim()) b++;

    /* the block runs until the next heading that shares any of its
       columns, or until the sheet goes quiet under it */
    let end = rows.length;
    for (const other of heads) {
      if (other.h <= head.h) continue;
      const oH = rows[other.h];
      let oa = other.c;
      while (oa > 0 && String(oH[oa - 1] || "").trim()) oa--;
      let ob = other.c;
      while (ob + 1 < oH.length && String(oH[ob + 1] || "").trim()) ob++;
      if (!(ob < a || oa > b)) { end = Math.min(end, other.h); break; }
    }
    let quiet = 0;
    for (let i = head.h + 1; i < end; i++) {
      const seg = (rows[i] || []).slice(a, b + 1);
      if (seg.every((x) => x == null || String(x).trim() === "")) {
        if (++quiet >= 40) { end = i - quiet + 1; break; }
      } else quiet = 0;
    }

    /* "7-р сарын өдөр тутмын бэлэн орлого" sits just above the heading */
    let month = null;
    for (let i = Math.max(0, head.h - 4); i < head.h && !month; i++) {
      (rows[i] || []).slice(Math.max(0, a - 2), b + 2).forEach((cell) => {
        const m = String(cell || "").match(/(\d{1,2})\s*-?\s*р\s*сар/i);
        if (m && !month) month = +m[1];
      });
    }

    const labels = H.slice(a, b + 1).map((x) => String(x || "").trim());
    return { row: head.h, a, b, end, month, labels };
  });
}

function readIncomeBlocks(sheet, year, visits) {
  const ws = wb.Sheets[sheet];
  const rows = grid(sheet);

  const pool = new Map();
  visits.forEach((v) => {
    if (!pool.has(v.key)) pool.set(v.key, []);
    pool.get(v.key).push(v);
  });

  const out = [];
  let skipped = 0, unnamed = 0, matched = 0, undated = 0;

  findBlocks(rows).forEach((block) => {
    const at = (re) => block.labels.findIndex((l) => re.test(l));
    const col = {
      date: at(/он сар/i),
      name: at(/^нэрс$/i),
      svc: at(/үйлчилгээ/i),
      phone: at(/утас|дугаар/i),
      note: at(/тэмдэглэл/i),
      amount: at(/^төлбөр$/i),
      bank: at(/^банк$/i),
      form: at(/төлбөрийн хэлбэр/i),
      payroll: at(PAYROLL),
    };
    const wide = MONEY_LABELS.map(([re, key]) => [block.labels.findIndex((l) => re.test(l)), key])
      .filter(([i]) => i >= 0);
    const moneyCols = [
      ...wide.map(([i]) => i),
      col.amount,
      col.payroll,
    ].filter((i) => i >= 0);
    if (!moneyCols.length) return;

    let last = null;
    for (let i = block.row + 1; i < block.end; i++) {
      const row = rows[i] || [];
      const seg = row.slice(block.a, block.b + 1);
      if (seg.every((x) => x == null || String(x).trim() === "")) continue;

      const name = String(seg[col.name] || "").trim();
      if (/^нэрс$/i.test(name) || /^total:?$/i.test(name)) continue;

      /* a SUM in a money cell means the line is a subtotal, not a sale */
      const isSubtotal = moneyCols.some((c) => {
        const cell = ws[XLSX.utils.encode_cell({ r: i, c: block.a + c })];
        return cell && cell.f;
      });
      if (isSubtotal) { skipped++; continue; }

      const d = col.date >= 0 ? toDate(seg[col.date], year) : null;
      if (d) last = d;

      const money = { golomt: 0, khan: 0, cash: 0, invoice: 0, barter: 0, refund: 0 };
      wide.forEach(([i2, key]) => (money[key] += num(seg[i2])));

      /* the early blocks carry one amount and name the bank beside it */
      if (col.amount >= 0) {
        const amount = num(seg[col.amount]);
        const bank = String(seg[col.bank] ?? "").trim();
        const form = String(seg[col.form] ?? "").trim();
        if (/нэхэмжлэх/i.test(form)) money.invoice += amount;
        else if (/голомт|golomt/i.test(bank)) money.golomt += amount;
        else if (/хаан|khan/i.test(bank)) money.khan += amount;
        else money.cash += amount;
      }

      const payroll = col.payroll >= 0 ? num(seg[col.payroll]) : 0;
      money.barter += payroll;

      const total =
        money.golomt + money.khan + money.cash + money.invoice + money.barter - money.refund;
      if (total === 0 && !name) continue;

      /* the cash blocks record a month but no day */
      let date = last;
      if (!date && block.month) {
        date = ymd(year, block.month, 1);
        if (date) undated++;
      }
      if (!date) continue;

      const notes = [String(seg[col.note] || "").trim()];
      if (payroll) notes.push("Цалингаас суутгасан");

      const record = {
        date,
        name,
        phone: col.phone >= 0 ? String(seg[col.phone] || "").trim() : "",
        services: col.svc >= 0 ? String(seg[col.svc] || "").trim() : "",
        ...money,
        cabin: 0, oxy: 0, led: 0, xcryo: 0, zero: 0, norma: 0, oxygen: 0,
        therapist: null, therapist_amount: 0, gift: 0,
        internal: payroll > 0,
        notes: notes.filter(Boolean).join(" · "),
        needs_review: !name || (!last && !!block.month),
      };
      if (!name) unnamed++;

      const arr = pool.get(date + "|" + norm(name).slice(0, 14));
      if (arr && arr.length) {
        const v = arr.shift();
        Object.assign(record, {
          cabin: v.cabin, oxy: v.oxy, led: v.led, xcryo: v.xcryo, zero: v.zero,
          norma: v.norma, oxygen: v.oxygen, therapist: v.therapist,
          therapist_amount: v.therapist_amount, gift: v.gift,
          internal: record.internal || v.internal,
          notes: [record.notes, v.notes].filter(Boolean).join(" · "),
        });
        matched++;
      }
      out.push(record);
    }
  });

  out.sort((x, y) => x.date.localeCompare(y.date));
  return { rows: out, skipped, unnamed, matched, undated };
}

/* ── customers: the phone book, two columns of it ── */
function readCustomers() {
  if (!wb.Sheets["Утасны жагсаалт"]) return { rows: [], noPhone: 0, duplicates: 0 };
  const rows = grid("Утасны жагсаалт");

  /* the sheet keeps two name/phone pairs side by side */
  const pairs = [];
  rows.forEach((row, h) => {
    if (!row) return;
    row.forEach((cell, c) => {
      if (/^(name|нэрс)$/i.test(String(cell || "").trim())) {
        const phone = row.findIndex((x, i) => i > c && /phone|утас/i.test(String(x || "")));
        if (phone > c) pairs.push({ h, name: c, phone });
      }
    });
  });

  const seen = new Map();
  let noPhone = 0, duplicates = 0;
  pairs.forEach((p) => {
    rows.slice(p.h + 1).forEach((row) => {
      if (!row) return;
      const name = String(row[p.name] || "").replace(/\s+/g, " ").trim();
      if (!name || /^(name|нэрс)$/i.test(name)) return;
      let phone = String(row[p.phone] ?? "").replace(/\D/g, "");
      if (phone.startsWith("976") && phone.length === 11) phone = phone.slice(3);
      if (phone.length !== 8) { noPhone++; return; }
      if (seen.has(phone)) { duplicates++; return; }
      seen.set(phone, { name: name.slice(0, 160), phone });
    });
  });

  return { rows: [...seen.values()], noPhone, duplicates };
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
    income: H.findIndex((c) => /орлого/i.test(c)),
    item: H.indexOf("Хэнээс"),
    qty: H.indexOf("Zarlaga"),
    unit: H.indexOf("Юунд"),
    amount: H.indexOf("Хэн"),
    paidWith: H.indexOf("Үлдэгдэл"),
    note: H.indexOf("Тэмдэглэл"),
  };
  const ws = wb.Sheets["Зардал"];
  const out = [];
  let income = 0, incomeSum = 0, subtotals = 0, unpriced = 0, undated = 0, undatedSum = 0;

  rows.slice(h + 1).forEach((r, k) => {
    if (!r) return;
    const excelRow = h + 1 + k;

    /* Only the total column is trusted. Lower down the sheet the columns
       shift — a row can put its amount where the quantity belongs — so
       working an amount out from unit × quantity turns a ₮8,750 bin-bag
       purchase into millions. Where the bookkeeper left the total empty
       the row is simply not a priced expense. */
    const amount = num(r[col.amount]);

    if (!amount) {
      /* the same sheet doubles as a till: a row with money only in Орлого
         is income or a balance carried forward, and belongs to the Income
         sheets rather than the expense ledger */
      if (col.income >= 0 && num(r[col.income])) {
        income++;
        incomeSum += num(r[col.income]);
      } else if (String(r[col.item] || "").trim()) {
        unpriced++;
      }
      return;
    }

    const cell = ws[XLSX.utils.encode_cell({ r: excelRow, c: col.amount })];
    if (cell && cell.f) {
      subtotals++;
      return;
    }

    const d = toDate(r[col.date], 2025);
    if (!d) {
      undated++;
      undatedSum += amount;
      return;
    }

    /* where the columns shifted, the description sits where the unit price
       normally would — text there can only be a description */
    let item = String(r[col.item] || "").trim();
    if (!item && col.unit >= 0 && !num(r[col.unit])) item = String(r[col.unit] || "").trim();

    out.push({
      date: d, item: item || "—", qty: num(r[col.qty]) || null, amount,
      paid_with: String(r[col.paidWith] || "").trim(),
      note: String(r[col.note] || "").trim(),
    });
  });

  return Object.assign(out, { income, incomeSum, subtotals, unpriced, undated, undatedSum });
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
  let res = readIncome(income, year, visits);
  let how = "";
  if (!res.rows.length) {
    /* the older sheets are laid out month by month instead of as one table */
    res = readIncomeBlocks(income, year, visits);
    how = " · read block by block";
  }
  if (!res.rows.length) {
    report.push(`${income}: skipped — no readable money columns`);
    continue;
  }
  const sum = res.rows.reduce(
    (s, r) => s + r.golomt + r.khan + r.cash + r.invoice + r.barter - r.refund, 0);
  grand += sum;
  grandRows += res.rows.length;
  report.push(
    `${income}: ${res.rows.length} sales · ₮${sum.toLocaleString("en-US")} · ` +
      `${res.matched} matched to ${visitSheet || "—"} · ${res.skipped} subtotal rows skipped · ` +
      `${res.unnamed} without a name (flagged)` +
      (res.undated ? ` · ${res.undated} dated to the 1st of their month (flagged)` : "") +
      how,
  );

  const values = res.rows.map(
    (r) =>
      `(${q(r.date)},${q(r.name)},${q(r.phone || "")},${q(r.services)},${r.golomt},${r.khan},${r.cash},${r.invoice},` +
      `${r.barter},${r.refund},${r.cabin},${r.oxy},${r.led},${r.xcryo},${r.zero},${r.norma},` +
      `${r.oxygen},${q(r.therapist)},${r.therapist_amount},${r.gift},${r.internal},` +
      `${r.needs_review},${q(r.notes)},'import')`,
  );

  chunks.push(`-- ── ${income} ──`);
  for (let i = 0; i < values.length; i += 200) {
    chunks.push(
      "insert into public.sales (sale_date,customer_name,phone,services,golomt,khan,cash,invoice,barter,refund," +
        "cryo_cabin,oxy_pro,led_pro,x_cryo,zerobody,normatec,oxygen,therapist,therapist_amount,gift_card," +
        "is_internal,needs_review,note,source) values\n" +
        values.slice(i, i + 200).join(",\n") +
        ";",
    );
  }
}

/* ── the service names the sheets actually used ──────────────────
   The Үйлчилгээ column is free text — a thousand distinct strings, most
   of them one-offs and shorthand. The dependable catalogue is the column
   headings of the device and package sheets; on top of that, a free-text
   label is taken as a real service only once it has been written at
   least ten times, which leaves the notes and payment scribbles out. */
const NOT_A_SERVICE = /urdchilgaa|урьдчилгаа|shiljuuleg|шилжүүлэг|golomt|голомт|хаан|khaan|данс|dans|total|нийт/i;
const SERVICE_MIN = 10;

/* the shorthand for the devices is unambiguous, so fold it in rather than
   keeping "CC", "cc" and "Cryo Cabin" as three different services */
const SERVICE_ALIAS = {
  cc: "Cryo Cabin",
  rl: "Led Pro",
  "red light": "Led Pro",
  zb: "Zerobody",
  nor: "Normatec",
  norm: "Normatec",
  oxy: "Oxy Pro",
  oxypro: "Oxy Pro",
  xcryo: "X cryo",
  teatree: "Tea tree",
};

const serviceNames = new Map();
const addService = (label) => {
  const key = String(label).replace(/\s+/g, " ").trim().toLowerCase();
  const name = SERVICE_ALIAS[key] || String(label).replace(/\s+/g, " ").trim();
  if (!name || name.length < 2 || name.length > 60) return;
  const slug = "legacy-" + norm(name).replace(/\s+/g, "-").slice(0, 50);
  if (slug !== "legacy-" && !serviceNames.has(slug)) serviceNames.set(slug, name);
};

/* the therapist columns sit among the device columns, so name them out */
const therapistNames = new Set();
for (const sheet of wb.SheetNames) {
  if (!/CryoStart/i.test(sheet)) continue;
  const head = grid(sheet)[0] || [];
  const from = head.findIndex((c) => /oxygen/i.test(String(c || "")));
  const to = head.findIndex((c) => /gift card|total income|нийт төлбөр/i.test(String(c || "")));
  if (from < 0 || to < 0) continue;
  for (let i = from + 1; i < to; i++) {
    const label = norm(head[i]);
    if (label && !/tuhuurumj/i.test(label)) therapistNames.add(label);
  }
}

/* device columns and package blocks name the services outright */
for (const sheet of wb.SheetNames) {
  if (!/^(\s*CryoStart|Багц)/i.test(sheet.trim())) continue;
  const rows = grid(sheet);
  const head =
    rows.find((r) => r && r.some((c) => String(c || "").includes("ХАРИЛЦАГЧ"))) || [];
  const start = head.findIndex((c) => String(c || "").includes("ХАРИЛЦАГЧ"));
  head.forEach((cell, i) => {
    const label = String(cell || "").trim();
    if (i <= start || !label) return;
    if (/харилцагч|он сар|tuhuurumj|total income|нийт төлбөр|notes|barter|дотоод|багцын тоо|эхэлсэн|notice/i.test(label)) return;
    if (therapistNames.has(norm(label))) return;
    addService(label);
  });
}

/* then the shorthand people actually typed, once it is not a one-off */
const freeText = new Map();
for (const sheet of wb.SheetNames) {
  if (!/Income/.test(sheet)) continue;
  const rows = grid(sheet);
  findBlocks(rows).forEach((block) => {
    const svc = block.labels.findIndex((l) => /үйлчилгээ/i.test(l));
    if (svc < 0) return;
    for (let i = block.row + 1; i < block.end; i++) {
      const raw = String((rows[i] || [])[block.a + svc] || "").trim();
      if (!raw || raw.length > 80) continue;
      raw.split(/[;,/+]+/).forEach((part) => {
        const label = part.replace(/\s+/g, " ").trim();
        if (!label || label.length < 2 || label.length > 40) return;
        if (/^\d+$/.test(label) || NOT_A_SERVICE.test(label)) return;
        const key = label.toLowerCase();
        const seen = freeText.get(key);
        freeText.set(key, { label: seen?.label || label, n: (seen?.n || 0) + 1 });
      });
    }
  });
}
[...freeText.values()].filter((v) => v.n >= SERVICE_MIN).forEach((v) => addService(v.label));
if (serviceNames.size) {
  report.push(`Үйлчилгээний нэр: ${serviceNames.size} distinct names from the Income sheets`);
  const values = [...serviceNames].map(
    ([slug, label], i) => `(${q(slug)},${q(label)},'legacy-import',${900 + i},false)`,
  );
  chunks.push("-- ── service names used in the sheets (kept inactive: history, not a price list) ──");
  for (let i = 0; i < values.length; i += 200) {
    chunks.push(
      "insert into public.services (slug,name,category,sort,active) values\n" +
        values.slice(i, i + 200).join(",\n") +
        "\non conflict (slug) do nothing;",
    );
  }
}

/* ── customers ── */
const cus = readCustomers();
if (cus.rows.length) {
  report.push(
    `Утасны жагсаалт: ${cus.rows.length} customers · ${cus.noPhone} without a valid phone ` +
      `(the table requires one, so they are left out) · ${cus.duplicates} repeated numbers merged`,
  );
  const values = cus.rows.map(
    (c) => `(${q(c.name)},${q(c.phone)},'workbook',${q("phones:" + c.phone)})`,
  );
  chunks.push("-- ── Утасны жагсаалт ──");
  for (let i = 0; i < values.length; i += 200) {
    chunks.push(
      "insert into public.customers (full_name,phone,source,source_key)\n" +
        "select v.* from (values\n" +
        values.slice(i, i + 200).join(",\n") +
        "\n) as v(full_name,phone,source,source_key)\n" +
        "where not exists (select 1 from public.customers c where c.phone = v.phone);",
    );
  }
}

const exp = readExpenses();
if (exp.length) {
  const expSum = exp.reduce((s, r) => s + r.amount, 0);
  report.push(
    `Зардал: ${exp.length} expenses · ₮${expSum.toLocaleString("en-US")}` +
      (exp.subtotals ? ` · ${exp.subtotals} subtotal rows skipped` : "") +
      (exp.income
        ? ` · ${exp.income} till-income rows left out (₮${exp.incomeSum.toLocaleString("en-US")}) — they belong to the Income sheets`
        : "") +
      (exp.unpriced ? ` · ${exp.unpriced} rows with a description but no total` : "") +
      (exp.undated ? ` · ${exp.undated} priced rows with no readable date (₮${exp.undatedSum.toLocaleString("en-US")})` : ""),
  );
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
writeParts(OUT, header, chunks);

console.log(report.join("\n"));
console.log(`\nTotal: ${grandRows} sales · ₮${grand.toLocaleString("en-US")}`);
