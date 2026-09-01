import { buildServiceAliasCandidates } from "./aliases.mjs";
import { classifyAmount } from "./amount.mjs";
import { parseLegacyDate } from "./date.mjs";
import { clusterDuplicateCandidates } from "./duplicates.mjs";
import { summarizeMappingSegments } from "./draft-mapping.mjs";
import { buildSourceKey, columnName, sha256Text, stableStringify } from "./hash.mjs";
import { mappingDigest, validateMapping } from "./mapping.mjs";
import { normalizeMongolianPhone } from "./phone.mjs";
import { classifyRow, detectHeaderSemantic, findHeaderCandidates } from "./rows.mjs";

export const PIPELINE_VERSION = "2.0.0";

const AMOUNT_FIELDS = new Set(["unit_price", "gross_amount", "net_amount", "payment_amount", "discount", "expense"]);

function isEmpty(value) {
  return value === null || value === undefined || value === "";
}

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

function increment(object, key) {
  object[key] = (object[key] ?? 0) + 1;
}

function formulaStats(values, formulas) {
  const stats = { formulas: 0, crossSheet: 0, external: 0, wholeColumn: 0, visibleErrors: 0 };
  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const width = Math.max(values[rowIndex]?.length ?? 0, formulas[rowIndex]?.length ?? 0);
    for (let columnIndex = 0; columnIndex < width; columnIndex += 1) {
      const value = values[rowIndex]?.[columnIndex];
      if (typeof value === "string" && /^(#REF!|#DIV\/0!|#VALUE!|#NAME\?|#N\/A|#NUM!|#NULL!)/i.test(value.trim())) {
        stats.visibleErrors += 1;
      }
      const formula = formulas[rowIndex]?.[columnIndex];
      if (typeof formula !== "string" || !formula.startsWith("=")) continue;
      stats.formulas += 1;
      if (formula.includes("!")) stats.crossSheet += 1;
      if (/\[[^\]]+\]/.test(formula)) stats.external += 1;
      if (/\$?[A-Z]{1,3}:\$?[A-Z]{1,3}/.test(formula)) stats.wholeColumn += 1;
    }
  }
  return stats;
}

function detectSemanticColumns(rows) {
  const semantics = new Map();
  for (const row of rows.slice(0, 30)) {
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const value = row[columnIndex];
      if (typeof value !== "string") continue;
      const semantic = detectHeaderSemantic(value);
      if (!semantic) continue;
      if (!semantics.has(semantic)) semantics.set(semantic, new Set());
      semantics.get(semantic).add(columnIndex);
    }
  }
  return semantics;
}

function analyzeSheet(snapshot, sheet) {
  const rows = sheet.values;
  const width = rows.reduce((max, row) => Math.max(max, row?.length ?? 0), 0);
  const rowTypes = { blank: 0, header: 0, subtotal: 0, note: 0, data: 0 };
  const classifications = rows.map((row) => classifyRow(row));
  for (const classification of classifications) increment(rowTypes, classification.type);

  const semantics = detectSemanticColumns(rows);
  const fieldSignals = Object.fromEntries(
    [...semantics.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([semantic, columns]) => [semantic, [...columns].sort((a, b) => a - b).map((index) => ({ index, column: columnName(index) }))]),
  );

  const phoneOutcomes = { valid: 0, blank: 0, quarantine: 0 };
  const dateOutcomes = { valid: 0, blank: 0, invalid: 0, ambiguous: 0 };
  const amountOutcomes = { valid: 0, blank: 0, invalid: 0, quarantine: 0, formula: 0 };
  const phoneCandidates = [];
  const serviceEntries = [];
  const duplicateRecords = [];
  const exactRows = new Map();

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const rowNumber = rowIndex + 1;
    const row = rows[rowIndex] ?? [];
    if (classifications[rowIndex].type !== "data") continue;
    const sourceKey = buildSourceKey({ fileSha256: snapshot.fileSha256, sheetIndex: sheet.index, row: rowNumber });
    const rowFingerprint = sha256Text(stableStringify(row));
    if (!exactRows.has(rowFingerprint)) exactRows.set(rowFingerprint, []);
    exactRows.get(rowFingerprint).push(sourceKey);

    for (const columnIndex of semantics.get("phone") ?? []) {
      const cellValue = row[columnIndex];
      const outcome = normalizeMongolianPhone(cellValue);
      increment(phoneOutcomes, outcome.state);
      if (outcome.state === "valid") {
        phoneCandidates.push({
          sourceKey: buildSourceKey({
            fileSha256: snapshot.fileSha256,
            sheetIndex: sheet.index,
            row: rowNumber,
            cell: `${columnName(columnIndex)}${rowNumber}`,
          }),
          fingerprint: outcome.e164,
        });
      }
    }

    for (const columnIndex of semantics.get("date") ?? []) {
      const outcome = parseLegacyDate(row[columnIndex], { textOrder: "DMY" });
      increment(dateOutcomes, outcome.state);
    }

    for (const [semantic, columns] of semantics.entries()) {
      if (!AMOUNT_FIELDS.has(semantic)) continue;
      for (const columnIndex of columns) {
        const outcome = classifyAmount(row[columnIndex]);
        increment(amountOutcomes, outcome.state);
      }
    }

    for (const columnIndex of semantics.get("service") ?? []) {
      const label = row[columnIndex];
      if (typeof label !== "string" || !label.trim()) continue;
      serviceEntries.push({
        sourceKey: buildSourceKey({
          fileSha256: snapshot.fileSha256,
          sheetIndex: sheet.index,
          row: rowNumber,
          cell: `${columnName(columnIndex)}${rowNumber}`,
        }),
        label,
      });
    }
    duplicateRecords.push({ sourceKey, fingerprint: rowFingerprint });
  }

  const duplicateCandidates = clusterDuplicateCandidates(duplicateRecords);
  const phoneDuplicateCandidates = clusterDuplicateCandidates(phoneCandidates);
  const aliasInput = serviceEntries.slice(0, 250);
  const aliasCandidates = buildServiceAliasCandidates(aliasInput);
  const category = safeCategory(sheet.name);
  const reviewIssues = [];
  if (duplicateCandidates.length) reviewIssues.push({ code: "exact_row_duplicate_candidates", count: duplicateCandidates.length });
  if (phoneDuplicateCandidates.length) reviewIssues.push({ code: "phone_identity_candidates", count: phoneDuplicateCandidates.length });
  if (dateOutcomes.ambiguous || dateOutcomes.invalid) {
    reviewIssues.push({ code: "date_cells_need_review", count: dateOutcomes.ambiguous + dateOutcomes.invalid });
  }
  if (amountOutcomes.quarantine || amountOutcomes.invalid) {
    reviewIssues.push({ code: "amount_cells_need_review", count: amountOutcomes.quarantine + amountOutcomes.invalid });
  }
  if (category === "packages" && width >= 50) reviewIssues.push({ code: "wide_package_unpivot_mapping_required", count: width });
  if (serviceEntries.length > aliasInput.length) reviewIssues.push({ code: "service_alias_scan_capped", count: serviceEntries.length - aliasInput.length });

  return {
    sheetIndex: sheet.index,
    category,
    usedRange: sheet.address,
    rows: rows.length,
    columns: width,
    rowTypes,
    headerCandidates: findHeaderCandidates(rows).map(({ row, confidence, reasons }) => ({ row, confidence, reasons })),
    fieldSignals,
    formulas: formulaStats(rows, sheet.formulas),
    quality: {
      phones: phoneOutcomes,
      dates: dateOutcomes,
      amounts: amountOutcomes,
      duplicateCandidateGroups: duplicateCandidates.length,
      phoneIdentityCandidateGroups: phoneDuplicateCandidates.length,
      serviceAliasCandidatePairs: aliasCandidates.length,
    },
    candidateIds: {
      duplicates: duplicateCandidates.map((candidate) => candidate.candidateId),
      phoneIdentities: phoneDuplicateCandidates.map((candidate) => candidate.candidateId),
      serviceAliases: aliasCandidates.map((candidate) => candidate.candidateId),
    },
    reviewIssues,
  };
}

export function analyzeWorkbookSnapshot(snapshot, { mapping = null } = {}) {
  const mappingValidation = mapping
    ? validateMapping(mapping, {
        workbookSha256: snapshot.fileSha256,
        sheetCount: snapshot.sheets.length,
        sheetRowCounts: snapshot.sheets.map((sheet) => sheet.values.length),
      })
    : {
        valid: false,
        structurallyValid: false,
        reviewRequired: true,
        issues: [{ code: "approved_mapping_required", path: "$" }],
      };
  const mappingSha256 = mapping ? mappingDigest(mapping) : null;
  const sheets = snapshot.sheets.map((sheet) => analyzeSheet(snapshot, sheet));
  const blockingIssues = mappingValidation.valid ? [] : mappingValidation.issues;
  const totals = sheets.reduce(
    (accumulator, sheet) => {
      accumulator.rows += sheet.rows;
      accumulator.formulas += sheet.formulas.formulas;
      accumulator.visibleFormulaErrors += sheet.formulas.visibleErrors;
      accumulator.reviewIssueCount += sheet.reviewIssues.reduce((sum, issue) => sum + issue.count, 0);
      return accumulator;
    },
    { rows: 0, formulas: 0, visibleFormulaErrors: 0, reviewIssueCount: 0 },
  );
  const manifestId = sha256Text(`${PIPELINE_VERSION}|${snapshot.fileSha256}|${mappingSha256 ?? "unmapped"}`);

  return {
    manifestVersion: 2,
    pipelineVersion: PIPELINE_VERSION,
    manifestId,
    source: {
      fileSha256: snapshot.fileSha256,
      reader: snapshot.reader,
      sheetCount: snapshot.sheets.length,
    },
    mapping: {
      provided: Boolean(mapping),
      sha256: mappingSha256,
      valid: mappingValidation.valid,
      structurallyValid: mappingValidation.structurallyValid,
      reviewRequired: mappingValidation.reviewRequired,
      segments: mapping ? summarizeMappingSegments(mapping) : null,
      issues: mappingValidation.issues,
    },
    sheets,
    totals,
    blockingIssues,
    readyForApproval: blockingIssues.length === 0,
    readyForApply: false,
    applyRequiresMatchingApproval: true,
    privacy: {
      rawCellValuesIncluded: false,
      customerNamesIncluded: false,
      phoneValuesIncluded: false,
      amountValuesIncluded: false,
    },
  };
}
