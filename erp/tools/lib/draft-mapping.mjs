import { columnName } from "./hash.mjs";
import { validateMapping } from "./mapping.mjs";
import { classifyRow, detectHeaderSemantic } from "./rows.mjs";

const CATEGORY_ENTITY = {
  sales_income: "sales",
  service_ledger: "service_sessions",
  packages: "package_redemptions",
  inventory: "inventory_movements",
  attendance_schedule: "attendance_events",
  expenses: "expenses",
  contacts: "customers",
  price_list: "price_list_versions",
  staff_compensation: "payroll_lines",
  barter: "barter_transactions",
  partner_or_other: null,
};

function safeCategory(name) {
  const label = String(name).normalize("NFKC").trim().toLocaleLowerCase("mn-MN");
  if (/income|borluula|борлуул/.test(label) || /7;8;9;10;11;12/.test(label)) return "sales_income";
  if (/cryostart/.test(label)) return "service_ledger";
  if (/багц|package/.test(label)) return "packages";
  if (/азот|nitrogen/.test(label)) return "inventory";
  if (/ирц|schedule|attendance/.test(label)) return "attendance_schedule";
  if (/зардал|expense/.test(label)) return "expenses";
  if (/утас|contact/.test(label)) return "contacts";
  if (/үнийн санал|quote|price/.test(label)) return "price_list";
  if (/salary|цалин|захирал/.test(label)) return "staff_compensation";
  if (/barter/.test(label)) return "barter";
  return "partner_or_other";
}

function isBlankRow(row) {
  return !Array.isArray(row) || row.every((value) => value === null || value === undefined || value === "");
}

function contiguousRuns(rows) {
  if (rows.length === 0) return [];
  const runs = [];
  let startRow = 1;
  let kind = isBlankRow(rows[0]) ? "blank" : "content";
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const nextKind = isBlankRow(rows[rowIndex]) ? "blank" : "content";
    if (nextKind === kind) continue;
    runs.push({ kind, startRow, endRow: rowIndex });
    startRow = rowIndex + 1;
    kind = nextKind;
  }
  runs.push({ kind, startRow, endRow: rows.length });
  return runs;
}

function splitContentRun(run, rows) {
  const headerRows = [];
  for (let rowNumber = run.startRow; rowNumber <= run.endRow; rowNumber += 1) {
    const classification = classifyRow(rows[rowNumber - 1]);
    if (classification.type === "header" && classification.confidence >= 0.75) headerRows.push(rowNumber);
  }

  const boundaries = [run.startRow, ...headerRows.filter((rowNumber) => rowNumber > run.startRow)];
  return boundaries.map((startRow, index) => ({
    kind: "content",
    startRow,
    endRow: (boundaries[index + 1] ?? (run.endRow + 1)) - 1,
  }));
}

function segmentFieldSignals(rows, startRow, endRow) {
  const semantics = new Map();
  for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
    const row = rows[rowNumber - 1] ?? [];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      if (typeof row[columnIndex] !== "string") continue;
      const semantic = detectHeaderSemantic(row[columnIndex]);
      if (!semantic) continue;
      if (!semantics.has(semantic)) semantics.set(semantic, new Set());
      semantics.get(semantic).add(columnIndex);
    }
  }

  return Object.fromEntries(
    [...semantics.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([semantic, indexes]) => [
        semantic,
        [...indexes].sort((left, right) => left - right).map((index) => ({ index, column: columnName(index) })),
      ]),
  );
}

function rowTypeCounts(rows, startRow, endRow) {
  const counts = { blank: 0, header: 0, subtotal: 0, note: 0, data: 0 };
  for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
    counts[classifyRow(rows[rowNumber - 1]).type] += 1;
  }
  return counts;
}

function reviewSegment({ sheet, category, startRow, endRow, segmentId }) {
  const fieldSignals = segmentFieldSignals(sheet.values, startRow, endRow);
  const headerRows = [];
  for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
    if (classifyRow(sheet.values[rowNumber - 1]).type === "header") headerRows.push(rowNumber);
  }
  const width = sheet.values
    .slice(startRow - 1, endRow)
    .reduce((maximum, row) => Math.max(maximum, row?.length ?? 0), 0);
  const proposedMode = category === "packages" && width >= 50 ? "wide_package" : "rows";
  const proposedEntity = CATEGORY_ENTITY[category];

  const segment = {
    segmentId,
    startRow,
    endRow,
    disposition: "review",
    reason: proposedEntity ? "content_requires_explicit_mapping" : "content_category_requires_owner_decision",
    proposedMode,
    proposedEntity,
    headerRows,
    fieldSignals,
    rowTypes: rowTypeCounts(sheet.values, startRow, endRow),
  };
  if (proposedMode === "wide_package") {
    const headerRowCandidate = headerRows[0] ?? startRow;
    segment.widePackageReview = {
      headerRowCandidate,
      dataStartRowCandidate: Math.min(endRow, headerRowCandidate + 1),
      identityFieldCandidates: Object.keys(fieldSignals).sort(),
      usageColumnsRequireExplicitReview: true,
      observedColumnCount: width,
    };
  }
  return segment;
}

function buildSheetProfile(sheet) {
  const category = safeCategory(sheet.name);
  if (sheet.values.length === 0) {
    return {
      sheetIndex: sheet.index,
      category,
      reason: "verified_empty_sheet",
      segments: [],
    };
  }

  const splitRuns = contiguousRuns(sheet.values).flatMap((run) => (
    run.kind === "blank" ? [run] : splitContentRun(run, sheet.values)
  ));
  return {
    sheetIndex: sheet.index,
    category,
    segments: splitRuns.map((run, index) => {
      const segmentId = `sheet-${sheet.index}-segment-${index + 1}`;
      if (run.kind === "blank") {
        return {
          segmentId,
          startRow: run.startRow,
          endRow: run.endRow,
          disposition: "skip",
          reason: "verified_blank_rows_only",
        };
      }
      return reviewSegment({ sheet, category, startRow: run.startRow, endRow: run.endRow, segmentId });
    }),
  };
}

export function summarizeMappingSegments(mapping) {
  const summary = { total: 0, import: 0, skip: 0, review: 0 };
  for (const sheet of mapping.sheets ?? []) {
    for (const segment of sheet.segments ?? []) {
      summary.total += 1;
      if (segment.disposition in summary) summary[segment.disposition] += 1;
    }
  }
  return summary;
}

export function buildDraftMapping(snapshot) {
  const mapping = {
    version: 2,
    status: "draft",
    workbookSha256: snapshot.fileSha256,
    sheets: snapshot.sheets.map(buildSheetProfile),
  };
  const validation = validateMapping(mapping, {
    workbookSha256: snapshot.fileSha256,
    sheetCount: snapshot.sheets.length,
    sheetRowCounts: snapshot.sheets.map((sheet) => sheet.values.length),
  });
  if (!validation.structurallyValid) {
    const error = new Error("draft_mapping_internal_validation_failed");
    error.code = "draft_mapping_internal_validation_failed";
    throw error;
  }
  return mapping;
}
