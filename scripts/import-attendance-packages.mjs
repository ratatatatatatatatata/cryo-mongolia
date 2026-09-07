/* ══════════════════════════════════════════════════════════════
   Fills the dashboard's Ирц and Багц sections from the workbook.

     npm i xlsx
     node scripts/import-attendance-packages.mjs "…/CRYO Mongolia борлуулалт хөтлөлт.xlsx"

   Writes supabase/local/import-attendance-packages.sql — that folder is
   gitignored, because these sheets carry staff hours and customer names.
   Paste it into the Supabase SQL editor.

   Sheets it reads
   · "Ирц <year>"   → public.staff (missing names) + public.staff_workdays
   · "Багц <year>"  → public.customer_package_contracts + package_redemptions

   How the package sheets are shaped: after the customer, the package
   description and the start date, the columns run in blocks of ten, one
   block per service, and each cell in a block holds the date that session
   was used. So a customer row becomes one contract per service block, and
   every dated cell in the block becomes a redemption against it.
   ══════════════════════════════════════════════════════════════ */

import XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FILE = process.argv[2];
if (!FILE) {
  console.error("usage: node scripts/import-attendance-packages.mjs <workbook.xlsx>");
  process.exit(1);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "supabase", "local", "import-attendance-packages.sql");

const wb = XLSX.readFile(FILE, { cellDates: true });
const grid = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null, raw: false });
const q = (v) =>
  v == null || String(v).trim() === "" ? "null" : "'" + String(v).trim().replace(/'/g, "''") + "'";
const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

/* the centre keeps local time; pin it so the timestamps do not drift */
const TZ = "+08";

/* ── dates: the sheets mix "1/7", "14/9/2025" and "2026.01.02" ── */
function ymd(y, mo, d) {
  if (!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
const pair = (a, b, year) => (a > 12 && b <= 12 ? ymd(year, b, a) : ymd(year, a, b));

function toDate(v, year) {
  if (v == null || v === "") return null;
  const s = String(v).trim().replace(/[\/.]{2,}/g, "/");
  let m = s.match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
  if (m) return pair(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})/);
  if (m) return pair(+m[1], +m[2], year);
  return null;
}

/* every date inside a cell — "1/7; 1/26" is two sessions, "1/9 Muji /milk" is one */
function datesIn(cell, year) {
  const s = String(cell ?? "");
  const out = [];
  const re = /(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{4}))?/g;
  let m;
  while ((m = re.exec(s))) {
    const d = m[3] ? pair(+m[1], +m[2], +m[3]) : pair(+m[1], +m[2], year);
    if (d) out.push(d);
  }
  return out;
}

/* ── clock times: "15:00", "1:00 PM", "9:30 AM", "1000", "10.30" ── */
function toTime(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || /day\s*off|off|амар/i.test(s)) return null;

  let m = s.match(/^(\d{1,2})[:.](\d{2})\s*(AM|PM)?$/i);
  if (m) {
    let h = +m[1];
    const mi = +m[2];
    const ap = (m[3] || "").toUpperCase();
    if (ap === "PM" && h < 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    if (h > 23 || mi > 59) return null;
    return String(h).padStart(2, "0") + ":" + String(mi).padStart(2, "0");
  }
  /* "1000" means 10:00 */
  m = s.match(/^(\d{1,2})(\d{2})$/);
  if (m) {
    const h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return String(h).padStart(2, "0") + ":" + String(mi).padStart(2, "0");
  }
  m = s.match(/^(\d{1,2})\s*(AM|PM)?$/i);
  if (m) {
    let h = +m[1];
    const ap = (m[2] || "").toUpperCase();
    if (ap === "PM" && h < 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    if (h > 23) return null;
    return String(h).padStart(2, "0") + ":00";
  }
  return null;
}

/* the attendance sheet writes staff in Latin, the sales sheets in Cyrillic */
const STAFF_ALIAS = { Sara: "Сараа", Saraa: "Сараа", Сараа: "Сараа" };
const canonical = (n) => STAFF_ALIAS[clean(n)] || clean(n);

/* ══════════════ ИРЦ ══════════════ */
function readAttendance(sheet, year) {
  const rows = grid(sheet);
  const head = (rows[0] || []).map(clean);
  const staff = [];
  head.forEach((name, i) => {
    if (i >= 3 && name) staff.push({ raw: name, name: canonical(name), col: i });
  });

  const shifts = [];
  const counter = {};
  let skipped = 0;

  rows.slice(2).forEach((r, k) => {
    if (!r) return;
    const excelRow = k + 3;
    const date = toDate(r[1], year);
    if (!date) return;

    staff.forEach((s) => {
      const inT = toTime(r[s.col]);
      if (!inT) {
        if (clean(r[s.col])) skipped++;
        return;
      }
      const outT = toTime(r[s.col + 1]);
      counter[s.name] = (counter[s.name] || 0) + 1;
      shifts.push({
        staff: s.name,
        date,
        n: counter[s.name],
        clockIn: `${date} ${inT}${TZ}`,
        clockOut: outT ? `${date} ${outT}${TZ}` : null,
        key: `${sheet}:${s.raw}:${date}`,
        sheet,
        row: excelRow,
      });
    });
  });

  return { shifts, staffNames: [...new Set(staff.map((s) => s.name))], skipped };
}

/* ══════════════ БАГЦ ══════════════ */
function readPackages(sheet, year) {
  const rows = grid(sheet);
  const hi = rows.findIndex((r) => r && r.some((c) => String(c || "").includes("ХАРИЛЦАГЧ")));
  if (hi < 0) return { contracts: [], redemptions: [] };
  const H = rows[hi].map(clean);

  const nameCol = H.findIndex((c) => c.includes("ХАРИЛЦАГЧ"));
  const descCol = H.findIndex((c) => c.includes("Багцын тоо"));
  const startCol = H.findIndex((c) => c.includes("эхэлсэн"));

  /* every other labelled column after the start date opens a service block */
  const blocks = [];
  H.forEach((label, i) => {
    if (i > startCol && label && !/notice/i.test(label)) blocks.push({ label, from: i });
  });
  blocks.forEach((b, i) => {
    b.to = i + 1 < blocks.length ? blocks[i + 1].from - 1 : H.length - 1;
  });

  const contracts = [];
  const redemptions = [];

  rows.slice(hi + 1).forEach((r, k) => {
    if (!r) return;
    const excelRow = hi + 2 + k;
    const customer = clean(r[nameCol]);
    if (!customer || /^total/i.test(customer)) return;

    const desc = clean(r[descCol]);
    const start = toDate(r[startCol], year);

    blocks.forEach((b) => {
      const used = [];
      for (let c = b.from; c <= b.to; c++) {
        datesIn(r[c], year).forEach((d, n) =>
          used.push({ date: d, key: `${sheet}:${excelRow}:${c}:${n}` }),
        );
      }
      if (!used.length) return;

      const capacity = (b.label.match(/(\d+)\s*$/) || [])[1];
      const total = capacity ? +capacity : null;
      const key = `${sheet}:${excelRow}:${b.from}`;

      contracts.push({
        key,
        customer,
        label: b.label,
        start,
        total,
        status: total && used.length < total ? "active" : "completed",
        notes: desc || null,
        sheet,
        row: excelRow,
      });
      used.forEach((u) => redemptions.push({ contractKey: key, ...u }));
    });
  });

  return { contracts, redemptions };
}

/* ══════════════ BUILD ══════════════ */
const attendanceSheets = wb.SheetNames.filter((n) => /^Ирц\s*\d{4}/.test(n.trim()));
const packageSheets = wb.SheetNames.filter((n) => /^Багц\s*\d{4}/.test(n.trim()));

const chunks = [];
const report = [];
const allStaff = new Set();
let shiftCount = 0;

for (const sheet of attendanceSheets) {
  const year = +(sheet.match(/(\d{4})/) || [])[1];
  const { shifts, staffNames, skipped } = readAttendance(sheet, year);
  staffNames.forEach((n) => allStaff.add(n));
  shiftCount += shifts.length;
  report.push(
    `${sheet}: ${shifts.length} shifts for ${staffNames.length} staff` +
      (skipped ? ` · ${skipped} day-off / unreadable cells skipped` : ""),
  );
  if (!shifts.length) continue;

  chunks.push(`-- ── ${sheet} ──`);
  for (let i = 0; i < shifts.length; i += 200) {
    const values = shifts
      .slice(i, i + 200)
      .map(
        (s) =>
          `((select id from public.staff where name = ${q(s.staff)}),${q(s.staff)},${q(s.date)},` +
          `${s.n},${q(s.clockIn)}::timestamptz,${s.clockOut ? q(s.clockOut) + "::timestamptz" : "null"},` +
          `'workbook',${q(s.key)},${q(s.sheet)},${s.row})`,
      )
      .join(",\n");
    chunks.push(
      "insert into public.staff_workdays\n" +
        "  (staff_id,staff_name,work_date,workday_number,clock_in,clock_out,source,source_key,workbook_sheet,workbook_row)\n" +
        "values\n" + values + "\n" +
        "on conflict (source_key) do nothing;",
    );
  }
}

let contractCount = 0, redemptionCount = 0;
const contractSql = [];
const redemptionSql = [];

for (const sheet of packageSheets) {
  const year = +(sheet.match(/(\d{4})/) || [])[1];
  const { contracts, redemptions } = readPackages(sheet, year);
  contractCount += contracts.length;
  redemptionCount += redemptions.length;
  report.push(
    `${sheet}: ${contracts.length} package contracts · ${redemptions.length} sessions used`,
  );
  if (!contracts.length) continue;

  contractSql.push(`-- ── ${sheet} ──`);
  for (let i = 0; i < contracts.length; i += 200) {
    const values = contracts
      .slice(i, i + 200)
      .map(
        (c) =>
          `(${q(c.customer)},${q(c.label)},${c.start ? q(c.start) : "null"},` +
          `${c.total ?? "null"},${q(c.status)},${q(c.key)},${q(c.notes)})`,
      )
      .join(",\n");
    contractSql.push(
      "insert into public.customer_package_contracts\n" +
        "  (customer_label,package_label,purchased_on,total_units,status,source_key,notes)\n" +
        "values\n" + values + "\n" +
        "on conflict do nothing;",
    );
  }

  redemptionSql.push(`-- ── ${sheet} ──`);
  for (let i = 0; i < redemptions.length; i += 300) {
    const values = redemptions
      .slice(i, i + 300)
      .map(
        (r) =>
          `((select id from public.customer_package_contracts where source_key = ${q(r.contractKey)}),` +
          `${q(r.date)},1,${q(r.key)})`,
      )
      .join(",\n");
    redemptionSql.push(
      "insert into public.package_redemptions (contract_id,used_on,units,source_key)\n" +
        "values\n" + values + "\n" +
        "on conflict (source_key) do nothing;",
    );
  }
}

const staffValues = [...allStaff]
  .map((n, i) => `(${q(n)},${100 + i})`)
  .join(", ");

const header = `-- ═══════════════════════════════════════════════════════════════
--  °CRYO Mongolia — Ирц and Багц, imported from the workbook
--  Generated ${new Date().toISOString().slice(0, 10)}
--
${report.map((l) => "--  " + l).join("\n")}
--
--  LOCAL ONLY — this file holds staff hours and customer names, and
--  supabase/local/ is gitignored so it never reaches the public repo.
--
--  Safe to re-run: every row carries a source_key and conflicts are
--  ignored, so nothing duplicates.
-- ═══════════════════════════════════════════════════════════════

-- staff seen in the attendance sheet ("Sara" is the same person the
-- sales sheets call "Сараа")
insert into public.staff (name, sort) values ${staffValues}
on conflict (name) do nothing;

`;

const body = [
  "-- ══════════ ИРЦ ══════════",
  ...chunks,
  "",
  "-- ══════════ БАГЦ — contracts ══════════",
  ...contractSql,
  "",
  "-- ══════════ БАГЦ — sessions used ══════════",
  ...redemptionSql,
].join("\n\n");

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, header + body + "\n");

console.log(report.join("\n"));
console.log(
  `\nstaff: ${allStaff.size} · shifts: ${shiftCount} · contracts: ${contractCount} · redemptions: ${redemptionCount}`,
);
console.log("wrote " + OUT);
