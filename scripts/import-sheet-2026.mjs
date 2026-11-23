/* ══════════════════════════════════════════════════════════════
   2026 from the live Google Sheet: packages, package visits, shifts.

     node scripts/import-sheet-2026.mjs path/to/workbook.xlsx
     node scripts/import-sheet-2026.mjs "<the sheet's link>"

   The sheet is named when the script is run. Its link is deliberately
   not written in this file: the repository is public, and the link opens
   a workbook of customer names, phone numbers and takings. To avoid
   retyping it, put the link on one line in supabase/local/sheet-url.txt
   (that folder is gitignored) and run the script with no argument.

   Writes supabase/local/import-sheet-2026-partN.sql — gitignored, the
   rows carry customer names and phone numbers. Run the parts in order
   in the Supabase SQL editor, after the staff_schedule migration.

   What it reads, and how the sheet says it:

   · "Багц 2026" — one row per customer's package. The colours carry the
     meaning, so the workbook is read with its cell styles:
       name cell green           the package is finished
       name cell white           the package is active
       slot cell pink            no such session in this package
       slot cell with a date     a session used ("1/23" = 23 January)
       slot cell empty, not pink a session still to come
     The columns run in blocks of ten, one block per device, so counting
     the cells that are not pink gives how many sessions of each device
     the package holds — no need to trust the free-text "Багцын тоо".

   · " CryoStart 2026" — the daily visit ledger. Rows whose notes say
     Pack / bagts are visits made on a package; each device used becomes
     a service session.

   · "Work Schedule" — who is on shift each day, March to December.
     The cleaning rota blocks ("Tseverlegee") are not shifts and are left
     out; where September was rewritten, the rewritten block is used.

   Only 2026 is taken.
   ══════════════════════════════════════════════════════════════ */

import XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeParts } from "./sql-parts.mjs";

const YEAR = 2026;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "supabase", "local", "import-sheet-2026.sql");

async function loadWorkbook(arg) {
  const saved = path.join(root, "supabase", "local", "sheet-url.txt");
  const source = arg || (fs.existsSync(saved) ? fs.readFileSync(saved, "utf8").trim() : "");
  if (!source) {
    console.error('Аль sheet-ийг уншихаа заана уу:\n  node scripts/import-sheet-2026.mjs "<файлын зам эсвэл Google Sheet-ийн холбоос>"\nэсвэл холбоосыг supabase/local/sheet-url.txt файлд нэг мөрөөр хадгална уу.');
    process.exit(1);
  }
  if (fs.existsSync(source)) return XLSX.read(fs.readFileSync(source), { cellStyles: true });
  const id = (source.match(/\/d\/([\w-]+)/) || [])[1];
  if (!id) throw new Error("Энэ нь файл ч биш, Google Sheet-ийн холбоос ч биш байна: " + source);
  const response = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`);
  if (!response.ok) throw new Error(`Sheet татаж чадсангүй (HTTP ${response.status}). Холбоосоор харах эрхтэй эсэхийг шалгана уу.`);
  return XLSX.read(Buffer.from(await response.arrayBuffer()), { cellStyles: true });
}

const wb = await loadWorkbook(process.argv[2]);
const sheet = (name) => wb.Sheets[wb.SheetNames.find((n) => n.trim() === name)];
const at = (ws, r, c) => ws[XLSX.utils.encode_cell({ r, c })];
const text = (ws, r, c) => { const cell = at(ws, r, c); return cell ? String(cell.w ?? cell.v ?? "").replace(/\s+/g, " ").trim() : ""; };
const q = (v) => (v == null || String(v).trim() === "" ? "null" : "'" + String(v).trim().replace(/'/g, "''") + "'");
const pad = (n) => String(n).padStart(2, "0");

/* ── colours ── */
function rgbOf(cell) {
  const colour = cell?.s?.fgColor?.rgb;
  if (!colour || !/^[0-9a-f]{6,8}$/i.test(colour)) return null;
  const hex = colour.slice(-6);
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
/* pink through red: "there is no such cell" */
const isPink = (cell) => { const c = rgbOf(cell); return !!c && c[0] >= 200 && c[0] - c[1] >= 25 && c[0] - c[2] >= 20; };
/* any green: "finished" */
const isGreen = (cell) => { const c = rgbOf(cell); return !!c && c[1] - c[0] >= 15 && c[1] - c[2] >= 15; };

/* ── dates: "1/23", "1/7/2026", "9//7", "10/23Vita", "1/7; 1/26" ── */
function ymd(mo, d) {
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  const date = new Date(Date.UTC(YEAR, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${YEAR}-${pad(mo)}-${pad(d)}`;
}
function datesIn(value) {
  const out = [];
  const re = /(\d{1,2})\s*\/+\s*(\d{1,2})(?:\s*\/+\s*(\d{4}))?/g;
  let m;
  while ((m = re.exec(String(value || "")))) {
    if (m[3] && Number(m[3]) !== YEAR) continue;
    const day = ymd(+m[1], +m[2]);
    if (day) out.push(day);
  }
  return out;
}
/* what is left of a cell once its dates are taken out — "milk eej", "free" */
const noteIn = (value) => String(value || "").replace(/(\d{1,2})\s*\/+\s*(\d{1,2})(?:\s*\/+\s*\d{4})?/g, " ").replace(/[;,/]+/g, " ").replace(/\s+/g, " ").trim();

/* the sheet's device columns, by the service they are in the dashboard */
const DEVICE = [
  [/body\s*therapy/i, "massage"], [/beauty/i, "facial"], [/cryo\s*cabin/i, "cryocabin"], [/led\s*pro/i, "ledpro"],
  [/oxy\s*pro/i, "oxypro"], [/x\s*cryo/i, "xcryo"], [/zerobody/i, "zerobody"], [/normatec/i, "normatec"], [/^oxygen/i, "oxygen"],
];
const slugOf = (label) => (DEVICE.find(([re]) => re.test(label)) || [])[1] || null;

const report = [];
const chunks = [];
const batch = (rows, size, build) => { for (let i = 0; i < rows.length; i += size) chunks.push(build(rows.slice(i, i + size))); };

/* ══════════════ БАГЦ 2026 ══════════════ */
const contracts = [], redemptions = [], packageCustomers = new Map();
{
  const ws = sheet("Багц 2026");
  if (!ws) throw new Error('"Багц 2026" хуудас олдсонгүй.');
  const range = XLSX.utils.decode_range(ws["!ref"]);
  let head = -1;
  for (let r = 0; r <= Math.min(10, range.e.r) && head < 0; r++) if (/ХАРИЛЦАГЧ/.test(text(ws, r, 1))) head = r;
  if (head < 0) throw new Error('"Багц 2026" хуудасны гарчгийн мөр олдсонгүй.');

  /* device blocks: every labelled column after the start date opens one */
  const blocks = [];
  let noticeCol = -1;
  for (let c = 4; c <= range.e.c; c++) {
    const label = text(ws, head, c);
    if (!label) continue;
    if (/notice/i.test(label)) { noticeCol = c; break; }
    blocks.push({ label, slug: slugOf(label), from: c });
  }
  blocks.forEach((block, i) => { block.to = (i + 1 < blocks.length ? blocks[i + 1].from : noticeCol > 0 ? noticeCol : range.e.c + 1) - 1; });

  let finished = 0, unmapped = new Set(), offGrid = 0;
  for (let r = head + 1; r <= range.e.r; r++) {
    const rawName = text(ws, r, 1);
    if (!rawName || /^total/i.test(rawName)) continue;
    const excelRow = r + 1;
    const phone = (rawName.match(/(?<!\d)(\d{8})(?!\d)/) || [])[1] || null;
    const name = rawName.replace(/(?<!\d)\d{8}(?!\d)/, " ").replace(/\s+/g, " ").trim() || rawName;
    const description = text(ws, r, 2);
    const done = isGreen(at(ws, r, 1));
    if (done) finished++;

    const units = [];
    blocks.forEach((block, order) => {
      let capacity = 0, used = 0;
      for (let c = block.from; c <= block.to; c++) {
        const cell = at(ws, r, c), value = text(ws, r, c);
        const days = datesIn(value);
        const pink = isPink(cell);
        /* a date written into a pink cell is still a session that happened */
        if (pink && days.length) offGrid++;
        if (!pink || days.length) capacity += Math.max(1, days.length);
        days.forEach((day, n) => {
          used++;
          redemptions.push({ contract: `sheet2026:pkg:${excelRow}`, key: `sheet2026:pkg:${excelRow}:${c}:${n}`, day, slug: block.slug, label: block.label.replace(/\s*\d+\s*$/, ""), note: noteIn(value) });
        });
      }
      if (capacity > 0) {
        if (!block.slug) unmapped.add(block.label);
        units.push({ slug: block.slug, label: block.label.replace(/\s*\d+\s*$/, ""), units: capacity, used, order });
      }
    });

    const total = units.reduce((sum, item) => sum + item.units, 0);
    /* a finished row can be all pink once it is cleared out; the description still says how many */
    const stated = !total ? Number((description.match(/(\d+)\s*(?:orolt|оролт)/i) || [])[1]) || null : null;
    const start = datesIn(text(ws, r, 3))[0] || null;
    const label = description || units.map((item) => `${item.label} ${item.units}`).join(" + ") || "Багц";
    const notice = noticeCol > 0 ? text(ws, r, noticeCol) : "";
    contracts.push({
      key: `sheet2026:pkg:${excelRow}`, name, phone, label: label.slice(0, 200), start,
      total: total || stated, status: done ? "completed" : "active",
      notes: [units.length ? units.map((item) => `${item.label}: ${item.used}/${item.units}`).join(" · ") : "", notice].filter(Boolean).join(" — ").slice(0, 1000) || null,
      units: units.filter((item) => item.slug),
    });
    if (phone && !packageCustomers.has(phone)) packageCustomers.set(phone, name);
  }
  const active = contracts.length - finished;
  report.push(`Багц 2026: ${contracts.length} багц — ${active} идэвхтэй, ${finished} дууссан (ногоон) · ${redemptions.length} оролт` +
    (offGrid ? ` · ${offGrid} оролт ягаан нүдэнд бичигдсэн (орсон гэж тооцсон)` : "") +
    (unmapped.size ? ` · самбарт үйлчилгээ нь тодорхойгүй багана: ${[...unmapped].join(", ")}` : ""));
}

/* ══════════════ CRYOSTART 2026 — visits made on a package ══════════════ */
const sessions = [];
{
  const ws = sheet("CryoStart 2026");
  if (ws) {
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const head = [];
    for (let c = 0; c <= range.e.c; c++) head[c] = text(ws, 0, c);
    const deviceCols = head.map((label, c) => ({ c, slug: slugOf(label), label })).filter((col) => col.slug && col.c >= 3 && col.c <= 9);
    const firstMoney = head.findIndex((label) => /tuhuurumj/i.test(label));
    let day = null, rows = 0;
    for (let r = 1; r <= range.e.r; r++) {
      const found = datesIn(text(ws, r, 2))[0];
      if (found) day = found;
      const name = text(ws, r, 1);
      if (!name || !day) continue;
      /* "Pack", "Pack2", "50% off Pack", "Goo saikhan bagts" in the money or notes columns */
      const remarks = [];
      for (let c = Math.max(firstMoney, 10); c <= Math.min(range.e.c, 22); c++) { const v = text(ws, r, c); if (/pack|bagts|багц/i.test(v)) remarks.push(v); }
      if (!remarks.length) continue;
      rows++;
      const used = deviceCols.filter((col) => Number(text(ws, r, col.c)) > 0);
      const note = `Багцаар · ${remarks.join(" · ")}`.slice(0, 1000);
      if (!used.length) sessions.push({ key: `sheet2026:cs:${r + 1}`, day, name, slug: null, label: "Багцын оролт", note });
      used.forEach((col) => {
        const count = Number(text(ws, r, col.c));
        sessions.push({ key: `sheet2026:cs:${r + 1}:${col.c}`, day, name, slug: col.slug, label: col.label.trim(), note: count > 1 ? `${note} · ×${count}` : note });
      });
    }
    report.push(`CryoStart 2026: багцаар орсон ${rows} мөр → ${sessions.length} үйлчилгээний бүртгэл`);
  } else report.push("CryoStart 2026: хуудас олдсонгүй");
}

/* ══════════════ WORK SCHEDULE — who is on shift ══════════════ */
const shifts = [];
const staffNames = new Set();
{
  const ws = sheet("Work Schedule");
  if (ws) {
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
    /* the sheet writes the same people several ways */
    const ALIAS = { urnaa: "Uranjargal", ouyka: "Oyuka", oyka: "Oyuka", sarantuya: "Сараа", sara: "Сараа", saraa: "Сараа" };
    const NOT_A_NAME = /^(names?|naadam|chuluu|nuhuv|amralt|new|off|day)$/i;

    const titles = [];
    for (let r = 0; r <= range.e.r; r++) for (let c = 0; c <= range.e.c; c++) {
      const v = text(ws, r, c);
      const month = MONTHS[v.slice(0, 3).toLowerCase()];
      if (month && /^[a-z]{3,9}\b/i.test(v)) titles.push({ r, c, month, title: v });
    }
    /* the cleaning rota is not a shift; a rewritten month replaces the first draft */
    const byMonth = new Map();
    titles.filter((t) => !/tseverleg|цэвэрлэг/i.test(t.title)).forEach((t) => {
      const current = byMonth.get(t.month);
      if (!current || /uurchlugd|өөрчлөгд/i.test(t.title)) byMonth.set(t.month, t);
    });
    const seen = new Set();
    let skippedBlocks = titles.length - byMonth.size;
    [...byMonth.values()].forEach((block) => {
      const nextRow = Math.min(...titles.filter((t) => t.c === block.c && t.r > block.r).map((t) => t.r), range.e.r + 1);
      const nextCol = Math.min(...titles.filter((t) => t.r === block.r && t.c > block.c).map((t) => t.c), range.e.c + 1);
      for (let r = block.r; r < nextRow; r++) {
        if (!/^date/i.test(text(ws, r, block.c + 1)) || !/^names?/i.test(text(ws, r + 1, block.c + 1))) continue;
        for (let c = block.c + 2; c < nextCol; c++) {
          const dayNumber = Number((text(ws, r, c).match(/^(\d{1,2})\s*\//) || [])[1]);
          const day = dayNumber ? ymd(block.month, dayNumber) : null;
          if (!day) continue;
          let last = null;
          text(ws, r + 1, c).split(/[;,.\s]+/).filter(Boolean).forEach((token) => {
            const hours = token.match(/^(\d{1,2})-(\d{1,2})$/);
            /* "Muujig 9-15" — the hours belong to the name before them */
            if (hours) { if (last) { last.from = `${pad(hours[1])}:00`; last.to = `${pad(hours[2])}:00`; } return; }
            if (!/^[A-Za-zА-Яа-яӨҮөүЁё-]{3,}$/.test(token) || NOT_A_NAME.test(token)) return;
            const name = ALIAS[token.toLowerCase()] || token[0].toUpperCase() + token.slice(1);
            if (seen.has(`${name}|${day}`)) return;
            seen.add(`${name}|${day}`);
            staffNames.add(name);
            last = { name, day, from: null, to: null };
            shifts.push(last);
          });
        }
      }
    });
    const days = new Set(shifts.map((s) => s.day));
    const span = [...days].sort();
    report.push(`Work Schedule: ${days.size} өдөр · ${shifts.length} ээлж · ${staffNames.size} ажилтан (${span[0]} – ${span.at(-1)})` +
      (skippedBlocks ? ` · ${skippedBlocks} блок алгассан (цэвэрлэгээний хуваарь, хуучин хувилбар)` : ""));
  } else report.push("Work Schedule: хуудас олдсонгүй");
}

/* ══════════════ SQL ══════════════ */

/* Has anybody worked on this package in the dashboard — recorded a visit by
   hand, taken a payment, booked against it, changed or transferred it? Once
   they have, the dashboard is where that package lives, and the sheet must
   not overwrite it: every statement below leaves such a package whole. */
const touched = (c) => `(
       exists (select 1 from public.package_redemptions m where m.contract_id = ${c}.id
                 and (m.source_key is null or (m.source_key not like 'sheet2026:%' and m.source_key not like 'Багц 20%')))
    or exists (select 1 from public.sales s where s.package_contract_id = ${c}.id)
    or exists (select 1 from public.bookings b where b.package_contract_id = ${c}.id)
    or exists (select 1 from public.package_account_events e where e.contract_id = ${c}.id))`;

const header = `-- ═══════════════════════════════════════════════════════════════
--  °CRYO Mongolia — ${YEAR} from the Google Sheet
--  Generated ${new Date().toISOString().slice(0, 10)} by scripts/import-sheet-2026.mjs
--
${report.map((line) => "--  " + line).join("\n")}
--
--  LOCAL ONLY — customer names and phone numbers; supabase/local/ is gitignored.
--  Run the staff_schedule migration first, then these parts in order.
--  Safe to run again: packages are brought up to date with the sheet, except
--  any that staff have since worked on in the dashboard — those are left whole.
-- ═══════════════════════════════════════════════════════════════

-- 1. The first import made one contract per device block and could not see
--    the colours. Those rows are superseded — unless someone has used them.
delete from public.package_redemptions r using public.customer_package_contracts c
 where r.contract_id = c.id
   and (c.source_key like 'Багц 2026:%' or c.source_key like 'Багц 2025:%')
   and not ${touched("c")};
delete from public.customer_package_contracts c
 where (c.source_key like 'Багц 2026:%' or c.source_key like 'Багц 2025:%')
   and not exists (select 1 from public.package_redemptions r where r.contract_id = c.id)
   and not ${touched("c")};

-- 2. This file's own visits are re-read from the sheet each time.
delete from public.package_redemptions r using public.customer_package_contracts c
 where r.contract_id = c.id and r.source_key like 'sheet2026:%'
   and not ${touched("c")};

delete from public.service_sessions where source_key like 'sheet2026:%';
delete from public.staff_schedule where source = 'workbook';

`;

if (staffNames.size) {
  chunks.push("-- staff named in the shift plan\n" +
    `insert into public.staff (name, sort) values ${[...staffNames].map((name, i) => `(${q(name)},${200 + i})`).join(", ")}\non conflict (name) do nothing;`);
}

if (packageCustomers.size) {
  chunks.push("-- package customers whose phone is written beside their name");
  batch([...packageCustomers], 200, (rows) =>
    "insert into public.customers (full_name, phone, source, source_key)\nselect v.* from (values\n" +
    rows.map(([phone, name]) => `(${q(name.slice(0, 160))},${q(phone)},'workbook',${q("sheet2026:" + phone)})`).join(",\n") +
    "\n) as v(full_name, phone, source, source_key)\nwhere not exists (select 1 from public.customers c where c.phone = v.phone);");
}

chunks.push("-- ══════════ БАГЦ — one contract per row of the sheet ══════════");
contracts.forEach((c) => {
  const units = c.units.length
    ? `coalesce((select jsonb_agg(jsonb_build_object('service_id', s.id, 'service_name', s.name, 'units', v.units) order by v.ord)\n     from (values ${c.units.map((item) => `(${q(item.slug)},${item.units},${item.order})`).join(", ")}) as v(slug, units, ord)\n     join public.services s on s.slug = v.slug), '[]'::jsonb)`
    : "'[]'::jsonb";
  chunks.push(
    "insert into public.customer_package_contracts as c\n  (customer_id, customer_label, package_label, purchased_on, total_units, status, source_key, notes, service_units)\n" +
    /* Every contract goes in as active, whatever its colour: the database
       refuses a visit against a package that is not active, and the visits
       of a finished package are history that still has to be loaded. The
       finished ones are marked at the very end, once their visits are in. */
    `select ${c.phone ? `(select id from public.customers where phone = ${q(c.phone)} limit 1)` : "null"}, ${q(c.name)}, ${q(c.label)}, ${c.start ? q(c.start) + "::date" : "null"}, ${c.total ?? "null"}, 'active', ${q(c.key)}, ${q(c.notes)},\n  ${units}\n` +
    /* A row already loaded is brought up to date rather than skipped, so a
       second run picks up what changed in the sheet — new sessions bought,
       a corrected name. It goes back to active for the same reason as above. */
    "on conflict (source_key) where source_key is not null do update set\n" +
    "  customer_label = excluded.customer_label, package_label = excluded.package_label, purchased_on = excluded.purchased_on,\n" +
    "  total_units = excluded.total_units, notes = excluded.notes, service_units = excluded.service_units, status = 'active'\n" +
    `where not ${touched("c")};`);
});

chunks.push("-- ══════════ БАГЦ — sessions used ══════════");
/* The rows name their contract and service by key and the join looks them
   up, which keeps each row short — the SQL editor has a size limit, and a
   subquery per row tripled the file. */
batch(redemptions, 700, (rows) =>
  "insert into public.package_redemptions (contract_id, used_on, units, service_id, service_label, notes, source_key)\n" +
  "select c.id, v.used_on::date, 1, s.id, v.label, nullif(v.note, ''), v.contract || ':' || v.cell\nfrom (values\n" +
  rows.map((r) => `(${q(r.contract)},${q(r.day)},${q(r.slug || "-")},${q(r.label)},'${r.note.slice(0, 500).replace(/'/g, "''")}',${q(r.key.slice(r.contract.length + 1))})`).join(",\n") +
  "\n) as v(contract, used_on, slug, label, note, cell)\njoin public.customer_package_contracts c on c.source_key = v.contract\nleft join public.services s on s.slug = v.slug\n" +
  "where not exists (select 1 from public.package_redemptions p where p.source_key = v.contract || ':' || v.cell)\n" +
  /* a visit the package's own list cannot account for would be refused and take the whole batch with it */
  "  and (s.id is not null or jsonb_array_length(c.service_units) = 0)\n" +
  `  and not ${touched("c")};`);

{
  const done = contracts.filter((c) => c.status === "completed").map((c) => c.key);
  if (done.length) {
    chunks.push("-- ══════════ БАГЦ — the green rows are finished ══════════\n" +
      "update public.customer_package_contracts c set status = 'completed'\n where c.source_key in (" + done.map(q).join(",") + ")\n   and not " + touched("c") + ";");
  }
}

if (sessions.length) {
  chunks.push("-- ══════════ CRYOSTART — visits made on a package ══════════");
  batch(sessions, 700, (rows) =>
    "insert into public.service_sessions (session_date, customer_label, service_id, service_label, status, notes, source_key)\n" +
    "select v.day::date, v.name, s.id, v.label, 'completed', v.note, v.key\nfrom (values\n" +
    rows.map((s) => `(${q(s.day)},${q(s.name.slice(0, 200))},${q(s.slug || "-")},${q(s.label)},${q(s.note)},${q(s.key)})`).join(",\n") +
    "\n) as v(day, name, slug, label, note, key)\nleft join public.services s on s.slug = v.slug\n" +
    "where not exists (select 1 from public.service_sessions x where x.source_key = v.key);");
}

if (shifts.length) {
  chunks.push("-- ══════════ WORK SCHEDULE — shifts ══════════");
  batch(shifts, 1000, (rows) =>
    "insert into public.staff_schedule (staff_id, staff_name, work_date, shift_start, shift_end, source, source_key)\n" +
    "select p.id, v.name, v.day::date, nullif(v.t1, '')::time, nullif(v.t2, '')::time, 'workbook', 'sheet2026:ws:' || v.name || ':' || v.day\nfrom (values\n" +
    rows.map((s) => `(${q(s.name)},${q(s.day)},'${s.from || ""}','${s.to || ""}')`).join(",\n") +
    "\n) as v(name, day, t1, t2)\nleft join public.staff p on p.name = v.name\n" +
    "where not exists (select 1 from public.staff_schedule x where x.staff_name = v.name and x.work_date = v.day::date);");
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
writeParts(OUT, header, chunks);
console.log(report.join("\n"));
