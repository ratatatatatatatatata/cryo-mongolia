import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { analyzeWorkbookSnapshot } from "./analyze.mjs";
import { canonicalizeServiceLabel } from "./aliases.mjs";
import { classifyAmount } from "./amount.mjs";
import { readWorkbookSnapshot } from "./artifact-reader.mjs";
import { buildContentAwareMapping, summarizeContentAwareMapping } from "./content-aware-mapping.mjs";
import { parseLegacyDate } from "./date.mjs";
import { buildDraftMapping, summarizeMappingSegments } from "./draft-mapping.mjs";
import { buildSourceKey } from "./hash.mjs";
import { mappingDigest, validateMapping } from "./mapping.mjs";
import { prepareOutputDirectory, writeNewJson, writeNewJsonLines } from "./output-policy.mjs";
import { buildWidePackageManifest } from "./packages.mjs";
import { normalizeMongolianPhone } from "./phone.mjs";
import { buildReconciliationSummary } from "./reconcile.mjs";
import { classifyRow } from "./rows.mjs";

async function readJson(filePath, code) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
}

export async function loadMappingFile(filePath) {
  return readJson(filePath, "mapping_file_invalid");
}

function parserOutcome(value, spec) {
  switch (spec.parser) {
    case "text":
      return value === null || value === undefined || value === ""
        ? { state: "blank", reason: "blank" }
        : { state: "valid", reason: null, value: String(value).normalize("NFKC").trim() };
    case "phone": {
      const parsed = normalizeMongolianPhone(value);
      return parsed.state === "valid" ? { ...parsed, value: parsed.e164 } : parsed;
    }
    case "date":
      return parseLegacyDate(value, {
        dateSystem: spec.dateSystem ?? "1900",
        textOrder: spec.textOrder ?? null,
        allowNumericTextSerial: spec.allowNumericTextSerial ?? false,
      });
    case "amount":
      return classifyAmount(value, {
        currency: spec.currency ?? "MNT",
        decimalSeparator: spec.decimalSeparator ?? null,
        allowNegative: spec.allowNegative ?? true,
        maxScale: spec.maxScale ?? (spec.currency && spec.currency !== "MNT" ? 2 : 0),
      });
    case "service": {
      if (value === null || value === undefined || value === "") return { state: "blank", reason: "blank" };
      const raw = String(value).normalize("NFKC").trim();
      const canonical = canonicalizeServiceLabel(raw);
      return canonical ? { state: "valid", reason: null, value: raw, canonical } : { state: "invalid", reason: "empty_service_label" };
    }
    case "integer": {
      const parsed = typeof value === "number" ? value : Number(String(value).trim());
      return Number.isSafeInteger(parsed)
        ? { state: "valid", reason: null, value: parsed }
        : { state: "invalid", reason: "invalid_integer" };
    }
    case "number": {
      const parsed = typeof value === "number" ? value : Number(String(value).trim());
      return Number.isFinite(parsed)
        ? { state: "valid", reason: null, value: parsed }
        : { state: "invalid", reason: "invalid_number" };
    }
    case "boolean": {
      if (typeof value === "boolean") return { state: "valid", reason: null, value };
      const normalized = String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("mn-MN");
      if (["true", "yes", "тийм", "1"].includes(normalized)) return { state: "valid", reason: null, value: true };
      if (["false", "no", "үгүй", "0"].includes(normalized)) return { state: "valid", reason: null, value: false };
      return normalized ? { state: "invalid", reason: "invalid_boolean" } : { state: "blank", reason: "blank" };
    }
    default:
      return { state: "invalid", reason: "unsupported_parser" };
  }
}

export function materializeMappedRows(snapshot, mapping, { deferReviewSegments = false } = {}) {
  const records = [];
  const quarantine = [];
  const sourceRows = { eligible: 0, imported: 0, quarantined: 0, ignored: 0 };
  if (deferReviewSegments) sourceRows.deferred = 0;

  for (const profile of mapping.sheets) {
    const sheet = snapshot.sheets.find((entry) => entry.index === profile.sheetIndex);
    if (!sheet) throw new Error("mapped_sheet_missing_from_snapshot");

    for (const segment of profile.segments) {
      if (segment.endRow > sheet.values.length) throw new Error("mapped_segment_exceeds_sheet_rows");
      if (segment.disposition === "review") {
        if (!deferReviewSegments) throw new Error("review_segment_cannot_be_materialized");
        const deferredRows = segment.endRow - segment.startRow + 1;
        sourceRows.eligible += deferredRows;
        sourceRows.deferred += deferredRows;
        continue;
      }
      if (segment.disposition === "skip") {
        const skippedRows = segment.endRow - segment.startRow + 1;
        sourceRows.eligible += skippedRows;
        sourceRows.ignored += skippedRows;
        continue;
      }

      if (segment.mode === "wide_package") {
        const reviewed = buildWidePackageManifest({
          fileSha256: snapshot.fileSha256,
          sheetIndex: profile.sheetIndex,
          headerRow: segment.headerRow,
          dataStartRow: segment.dataStartRow,
          dataEndRow: segment.endRow,
          identityColumns: segment.identityColumns,
          usageColumns: segment.usageColumns,
        });
        const approvedManifest = { ...reviewed, state: "approved" };

        for (let rowNumber = segment.startRow; rowNumber <= segment.endRow; rowNumber += 1) {
          sourceRows.eligible += 1;
          const row = sheet.values[rowNumber - 1] ?? [];
          if (rowNumber < segment.dataStartRow || classifyRow(row).type !== "data") {
            sourceRows.ignored += 1;
            continue;
          }

          const identity = Object.fromEntries(
            approvedManifest.identityFields.map((entry) => [entry.targetField, row[entry.sourceColumnIndex] ?? null]),
          );
          const usageEntries = approvedManifest.usageCells
            .map((usage) => ({ usage, rawValue: row[usage.sourceColumnIndex] }))
            .filter((entry) => entry.rawValue !== null && entry.rawValue !== undefined && entry.rawValue !== "");
          if (usageEntries.length === 0) {
            sourceRows.ignored += 1;
            continue;
          }

          const parsedEntries = usageEntries.map((entry) => ({
            ...entry,
            outcome: parserOutcome(entry.rawValue, {
              parser: entry.usage.parser,
              textOrder: segment.textOrder ?? "DMY",
            }),
          }));
          const invalidEntries = parsedEntries.filter((entry) => entry.outcome.state !== "valid");
          if (invalidEntries.length) {
            sourceRows.quarantined += 1;
            quarantine.push({
              sourceKey: buildSourceKey({
                fileSha256: snapshot.fileSha256,
                sheetIndex: profile.sheetIndex,
                row: rowNumber,
              }),
              entity: segment.entity,
              reasonCodes: [...new Set(invalidEntries.map((entry) => entry.outcome.reason))].sort(),
              raw: {
                identity,
                usageValues: usageEntries.map((entry) => ({ column: entry.usage.sourceColumn, value: entry.rawValue })),
              },
            });
            continue;
          }

          sourceRows.imported += 1;
          for (const entry of parsedEntries) {
            records.push({
              sourceKey: buildSourceKey({
                fileSha256: snapshot.fileSha256,
                sheetIndex: profile.sheetIndex,
                row: rowNumber,
                cell: `${entry.usage.sourceColumn}${rowNumber}`,
              }),
              entity: segment.entity,
              fields: { ...identity, [entry.usage.targetField]: entry.outcome.value ?? entry.outcome.canonical },
            });
          }
        }
        continue;
      }

      for (let rowNumber = segment.startRow; rowNumber <= segment.endRow; rowNumber += 1) {
        const row = sheet.values[rowNumber - 1] ?? [];
        const classification = classifyRow(row);
        sourceRows.eligible += 1;
        if (classification.type !== "data") {
          sourceRows.ignored += 1;
          continue;
        }

        const sourceKey = buildSourceKey({ fileSha256: snapshot.fileSha256, sheetIndex: profile.sheetIndex, row: rowNumber });
        const fields = {};
        const raw = {};
        const sourceFormulas = {};
        const issues = [];
        for (const [field, spec] of Object.entries(segment.columns)) {
          const value = row[spec.index];
          raw[field] = value ?? null;
          const formula = sheet.formulas[rowNumber - 1]?.[spec.index];
          if (typeof formula === "string" && formula.startsWith("=")) sourceFormulas[field] = formula;
          const parsed = parserOutcome(value, spec);
          if (parsed.state === "valid") {
            fields[field] = parsed.value ?? parsed.canonical;
            if (parsed.canonical && spec.parser === "service") fields[`${field}Canonical`] = parsed.canonical;
          } else if (parsed.state === "blank" && !spec.required) {
            fields[field] = null;
          } else {
            issues.push(`${field}:${parsed.reason}`);
          }
        }

        if (issues.length) {
          sourceRows.quarantined += 1;
          quarantine.push({ sourceKey, entity: segment.entity, reasonCodes: issues.sort(), raw, sourceFormulas });
        } else {
          sourceRows.imported += 1;
          records.push({ sourceKey, entity: segment.entity, fields, sourceFormulas });
        }
      }
    }
  }

  const reconciliation = buildReconciliationSummary({ rows: sourceRows });
  return {
    records,
    quarantine,
    sourceRows,
    recordsMaterialized: records.length,
    reconciliation,
  };
}

export async function runDraftMapping({ workbookPath, outputDir, repoRoot, explicitOutput, artifactModuleRoot }) {
  const safeOutput = await prepareOutputDirectory({ outputDir, repoRoot, explicit: explicitOutput });
  const snapshot = await readWorkbookSnapshot(workbookPath, { artifactModuleRoot });
  const mapping = buildDraftMapping(snapshot);
  const digest = mappingDigest(mapping);
  const fileName = `draft-mapping-${snapshot.fileSha256.slice(0, 12)}-${digest.slice(0, 12)}.json`;
  const destination = join(safeOutput, fileName);
  await writeNewJson(destination, mapping);
  return {
    destination,
    mapping,
    summary: summarizeMappingSegments(mapping),
  };
}

export async function runContentAwareMapping({ workbookPath, outputDir, repoRoot, explicitOutput, artifactModuleRoot }) {
  const safeOutput = await prepareOutputDirectory({ outputDir, repoRoot, explicit: explicitOutput });
  const snapshot = await readWorkbookSnapshot(workbookPath, { artifactModuleRoot });
  const mapping = buildContentAwareMapping(snapshot);
  const digest = mappingDigest(mapping);
  const fileName = `content-mapping-${snapshot.fileSha256.slice(0, 12)}-${digest.slice(0, 12)}.json`;
  const destination = join(safeOutput, fileName);
  await writeNewJson(destination, mapping);
  return {
    destination,
    mapping,
    summary: summarizeContentAwareMapping(mapping),
  };
}

export async function runDryRun({ workbookPath, mapping = null, outputDir, repoRoot, explicitOutput, artifactModuleRoot }) {
  const safeOutput = await prepareOutputDirectory({ outputDir, repoRoot, explicit: explicitOutput });
  const snapshot = await readWorkbookSnapshot(workbookPath, { artifactModuleRoot });
  const manifest = analyzeWorkbookSnapshot(snapshot, { mapping });
  if (mapping && manifest.mapping.structurallyValid) {
    const preview = materializeMappedRows(snapshot, mapping, { deferReviewSegments: true });
    manifest.contentAwarePreview = {
      recordsMaterialized: preview.recordsMaterialized,
      sourceRows: preview.sourceRows,
      reconciliation: preview.reconciliation,
    };
  }
  const fileName = `review-${snapshot.fileSha256.slice(0, 12)}-${manifest.manifestId.slice(0, 12)}.json`;
  const destination = join(safeOutput, fileName);
  await writeNewJson(destination, manifest);
  return { destination, manifest };
}

export async function approveDryRun({ manifestPath, confirmManifestId, outputDir, repoRoot, explicitOutput }) {
  const safeOutput = await prepareOutputDirectory({ outputDir, repoRoot, explicit: explicitOutput });
  const manifest = await readJson(manifestPath, "review_manifest_invalid");
  if (manifest.manifestId !== confirmManifestId) {
    const error = new Error("manifest_confirmation_mismatch");
    error.code = "manifest_confirmation_mismatch";
    throw error;
  }
  if (!manifest.readyForApproval || !manifest.mapping?.valid) {
    const error = new Error("manifest_not_ready_for_approval");
    error.code = "manifest_not_ready_for_approval";
    throw error;
  }
  if (
    manifest.privacy?.rawCellValuesIncluded !== false ||
    manifest.privacy?.customerNamesIncluded !== false ||
    manifest.privacy?.phoneValuesIncluded !== false ||
    manifest.privacy?.amountValuesIncluded !== false
  ) {
    const error = new Error("manifest_privacy_contract_failed");
    error.code = "manifest_privacy_contract_failed";
    throw error;
  }

  const approval = {
    approvalVersion: 1,
    approved: true,
    approvedAt: new Date().toISOString(),
    manifestId: manifest.manifestId,
    workbookSha256: manifest.source.fileSha256,
    mappingSha256: manifest.mapping.sha256,
    scope: "local_private_materialization_only",
    databaseWriteAuthorized: false,
    networkWriteAuthorized: false,
  };
  const fileName = `approval-${manifest.manifestId.slice(0, 12)}.json`;
  const destination = join(safeOutput, fileName);
  await writeNewJson(destination, approval);
  return { destination, approval };
}

export async function applyApprovedLocally({
  workbookPath,
  mapping,
  manifestPath,
  approvalPath,
  outputDir,
  repoRoot,
  explicitOutput,
  artifactModuleRoot,
}) {
  const safeOutput = await prepareOutputDirectory({ outputDir, repoRoot, explicit: explicitOutput });
  const manifest = await readJson(manifestPath, "review_manifest_invalid");
  const approval = await readJson(approvalPath, "approval_file_invalid");
  const snapshot = await readWorkbookSnapshot(workbookPath, { artifactModuleRoot });
  const validation = validateMapping(mapping, {
    workbookSha256: snapshot.fileSha256,
    sheetCount: snapshot.sheets.length,
    sheetRowCounts: snapshot.sheets.map((sheet) => sheet.values.length),
  });
  const currentMappingSha256 = mappingDigest(mapping);

  if (!validation.valid) {
    const error = new Error("mapping_validation_failed");
    error.code = "mapping_validation_failed";
    throw error;
  }
  const matches =
    manifest.readyForApproval === true &&
    manifest.mapping?.valid === true &&
    approval.approved === true &&
    approval.scope === "local_private_materialization_only" &&
    approval.databaseWriteAuthorized === false &&
    approval.networkWriteAuthorized === false &&
    approval.manifestId === manifest.manifestId &&
    approval.workbookSha256 === snapshot.fileSha256 &&
    approval.mappingSha256 === currentMappingSha256 &&
    manifest.source.fileSha256 === snapshot.fileSha256 &&
    manifest.mapping.sha256 === currentMappingSha256;
  if (!matches) {
    const error = new Error("approval_or_hash_mismatch");
    error.code = "approval_or_hash_mismatch";
    throw error;
  }

  const materialized = materializeMappedRows(snapshot, mapping);
  const stem = `${snapshot.fileSha256.slice(0, 12)}-${manifest.manifestId.slice(0, 12)}`;
  const recordsPath = join(safeOutput, `normalized-${stem}.jsonl`);
  const quarantinePath = join(safeOutput, `quarantine-${stem}.jsonl`);
  const reconciliationPath = join(safeOutput, `reconciliation-${stem}.json`);
  await writeNewJsonLines(recordsPath, materialized.records);
  await writeNewJsonLines(quarantinePath, materialized.quarantine);
  await writeNewJson(reconciliationPath, materialized.reconciliation);

  return {
    destinations: {
      records: basename(recordsPath),
      quarantine: basename(quarantinePath),
      reconciliation: basename(reconciliationPath),
    },
    counts: {
      records: materialized.records.length,
      quarantine: materialized.quarantine.length,
      sourceRows: materialized.sourceRows,
      recordsMaterialized: materialized.recordsMaterialized,
    },
    reconciliation: materialized.reconciliation,
  };
}
