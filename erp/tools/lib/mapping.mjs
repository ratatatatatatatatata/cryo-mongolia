import { sha256Text, stableStringify } from "./hash.mjs";

const PARSERS = new Set(["text", "phone", "date", "amount", "service", "integer", "number", "boolean"]);
const ENTITIES = new Set([
  "customers", "services", "staff_profiles", "sales", "sale_lines", "payments", "service_sessions",
  "package_templates", "package_contracts", "customer_entitlements", "package_redemptions",
  "inventory_movements", "attendance_events", "payroll_lines", "expenses", "barter_transactions",
  "price_list_versions",
]);
const DISPOSITIONS = new Set(["import", "skip", "review"]);
const IMPORT_MODES = new Set(["rows", "wide_package"]);

function issue(code, path) {
  return { code, path };
}

function object(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateParserColumns(columns, path, issues) {
  if (!object(columns) || Object.keys(columns).length === 0) {
    issues.push(issue("columns_object_required", path));
    return;
  }

  for (const [field, column] of Object.entries(columns)) {
    const columnPath = `${path}.${field}`;
    if (!field.trim()) issues.push(issue("target_field_required", columnPath));
    if (!Number.isInteger(column?.index) || column.index < 0) issues.push(issue("invalid_column_index", `${columnPath}.index`));
    if (!PARSERS.has(column?.parser)) issues.push(issue("unsupported_parser", `${columnPath}.parser`));
    if (column?.parser === "date" && column.textOrder !== undefined && !["DMY", "MDY"].includes(column.textOrder)) {
      issues.push(issue("invalid_date_text_order", `${columnPath}.textOrder`));
    }
  }
}

function validateWidePackage(segment, path, issues) {
  if (!Number.isInteger(segment.headerRow) || segment.headerRow < segment.startRow || segment.headerRow >= segment.dataStartRow) {
    issues.push(issue("invalid_header_row", `${path}.headerRow`));
  }
  if (!Number.isInteger(segment.dataStartRow) || segment.dataStartRow <= segment.startRow || segment.dataStartRow > segment.endRow) {
    issues.push(issue("invalid_data_start_row", `${path}.dataStartRow`));
  }
  if (!object(segment.identityColumns) || Object.keys(segment.identityColumns).length === 0) {
    issues.push(issue("identity_columns_required", `${path}.identityColumns`));
  } else {
    for (const [field, columnIndex] of Object.entries(segment.identityColumns)) {
      if (!Number.isInteger(columnIndex) || columnIndex < 0) {
        issues.push(issue("invalid_identity_column", `${path}.identityColumns.${field}`));
      }
    }
  }
  if (!Array.isArray(segment.usageColumns) || segment.usageColumns.length === 0) {
    issues.push(issue("usage_columns_required", `${path}.usageColumns`));
  } else {
    const seenUsageColumns = new Set();
    for (const [usageIndex, usage] of segment.usageColumns.entries()) {
      const usagePath = `${path}.usageColumns[${usageIndex}]`;
      const columnIndex = typeof usage === "number" ? usage : usage?.columnIndex;
      if (!Number.isInteger(columnIndex) || columnIndex < 0) {
        issues.push(issue("invalid_usage_column", usagePath));
        continue;
      }
      if (seenUsageColumns.has(columnIndex)) issues.push(issue("duplicate_usage_column", usagePath));
      seenUsageColumns.add(columnIndex);
      const parser = typeof usage === "number" ? "date" : usage?.parser ?? "date";
      if (!PARSERS.has(parser)) issues.push(issue("unsupported_parser", `${usagePath}.parser`));
    }
  }
}

export function mappingDigest(mapping) {
  return sha256Text(stableStringify(mapping));
}

export function validateMapping(mapping, { workbookSha256, sheetCount, sheetRowCounts }) {
  const structuralIssues = [];
  const approvalIssues = [];
  if (!object(mapping)) {
    return {
      valid: false,
      structurallyValid: false,
      reviewRequired: false,
      issues: [issue("mapping_object_required", "$")],
    };
  }
  if (mapping.version !== 2) structuralIssues.push(issue("mapping_version_must_be_2", "$.version"));
  if (mapping.workbookSha256 !== workbookSha256) structuralIssues.push(issue("mapping_workbook_hash_mismatch", "$.workbookSha256"));
  if (!Number.isInteger(sheetCount) || sheetCount < 0) structuralIssues.push(issue("invalid_sheet_count", "source.sheetCount"));
  if (!Array.isArray(sheetRowCounts) || sheetRowCounts.length !== sheetCount || sheetRowCounts.some((count) => !Number.isInteger(count) || count < 0)) {
    structuralIssues.push(issue("sheet_row_counts_required", "source.sheetRowCounts"));
  }
  if (!Array.isArray(mapping.sheets)) structuralIssues.push(issue("mapping_sheets_array_required", "$.sheets"));
  if (structuralIssues.length) {
    return {
      valid: false,
      structurallyValid: false,
      reviewRequired: false,
      issues: structuralIssues,
    };
  }

  if (mapping.status !== "reviewed") approvalIssues.push(issue("mapping_status_not_reviewed", "$.status"));

  const seenSheets = new Set();
  const seenSegmentIds = new Set();
  for (const [profileIndex, profile] of mapping.sheets.entries()) {
    const path = `$.sheets[${profileIndex}]`;
    if (!object(profile)) {
      structuralIssues.push(issue("sheet_profile_object_required", path));
      continue;
    }
    if (!Number.isInteger(profile.sheetIndex) || profile.sheetIndex < 0 || profile.sheetIndex >= sheetCount) {
      structuralIssues.push(issue("invalid_sheet_index", `${path}.sheetIndex`));
      continue;
    }
    if (seenSheets.has(profile.sheetIndex)) structuralIssues.push(issue("duplicate_sheet_profile", `${path}.sheetIndex`));
    seenSheets.add(profile.sheetIndex);

    const rowCount = sheetRowCounts[profile.sheetIndex];
    if (!Array.isArray(profile.segments)) {
      structuralIssues.push(issue("segments_array_required", `${path}.segments`));
      continue;
    }
    if (rowCount === 0) {
      if (profile.segments.length !== 0) structuralIssues.push(issue("empty_sheet_must_have_no_segments", `${path}.segments`));
      if (typeof profile.reason !== "string" || !profile.reason.trim()) {
        structuralIssues.push(issue("empty_sheet_reason_required", `${path}.reason`));
      }
      continue;
    }
    if (profile.segments.length === 0) {
      structuralIssues.push(issue("segments_required_for_nonempty_sheet", `${path}.segments`));
      continue;
    }

    let expectedStartRow = 1;
    for (const [segmentIndex, segment] of profile.segments.entries()) {
      const segmentPath = `${path}.segments[${segmentIndex}]`;
      if (!object(segment)) {
        structuralIssues.push(issue("segment_object_required", segmentPath));
        continue;
      }
      if (typeof segment.segmentId !== "string" || !segment.segmentId.trim()) {
        structuralIssues.push(issue("segment_id_required", `${segmentPath}.segmentId`));
      } else if (seenSegmentIds.has(segment.segmentId)) {
        structuralIssues.push(issue("duplicate_segment_id", `${segmentPath}.segmentId`));
      } else {
        seenSegmentIds.add(segment.segmentId);
      }

      const boundsValid = Number.isInteger(segment.startRow) && Number.isInteger(segment.endRow)
        && segment.startRow >= 1 && segment.endRow >= segment.startRow && segment.endRow <= rowCount;
      if (!boundsValid) {
        structuralIssues.push(issue("invalid_segment_bounds", segmentPath));
      } else {
        if (segment.startRow > expectedStartRow) structuralIssues.push(issue("segment_coverage_gap", `${segmentPath}.startRow`));
        if (segment.startRow < expectedStartRow) structuralIssues.push(issue("segment_overlap_or_out_of_order", `${segmentPath}.startRow`));
        expectedStartRow = Math.max(expectedStartRow, segment.endRow + 1);
      }

      if (!DISPOSITIONS.has(segment.disposition)) {
        structuralIssues.push(issue("invalid_disposition", `${segmentPath}.disposition`));
        continue;
      }
      if (segment.disposition === "review") {
        if (typeof segment.reason !== "string" || !segment.reason.trim()) {
          structuralIssues.push(issue("review_reason_required", `${segmentPath}.reason`));
        }
        approvalIssues.push(issue("segment_review_required", segmentPath));
        continue;
      }
      if (segment.disposition === "skip") {
        if (typeof segment.reason !== "string" || !segment.reason.trim()) {
          structuralIssues.push(issue("skip_reason_required", `${segmentPath}.reason`));
        }
        continue;
      }

      if (!ENTITIES.has(segment.entity)) structuralIssues.push(issue("unsupported_entity", `${segmentPath}.entity`));
      if (!IMPORT_MODES.has(segment.mode)) {
        structuralIssues.push(issue("unsupported_import_mode", `${segmentPath}.mode`));
      } else if (segment.mode === "rows") {
        validateParserColumns(segment.columns, `${segmentPath}.columns`, structuralIssues);
      } else {
        validateWidePackage(segment, segmentPath, structuralIssues);
      }
    }

    if (expectedStartRow <= rowCount) structuralIssues.push(issue("segment_coverage_gap", `${path}.segments`));
  }

  for (let sheetIndex = 0; sheetIndex < sheetCount; sheetIndex += 1) {
    if (!seenSheets.has(sheetIndex)) structuralIssues.push(issue("sheet_profile_missing", `sheet:${sheetIndex}`));
  }

  const issues = [...structuralIssues, ...approvalIssues];
  return {
    valid: issues.length === 0,
    structurallyValid: structuralIssues.length === 0,
    reviewRequired: approvalIssues.length > 0,
    issues,
  };
}
