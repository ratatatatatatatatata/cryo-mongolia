import { buildDraftMapping } from "./draft-mapping.mjs";
import { validateMapping } from "./mapping.mjs";
import { parseLegacyDate } from "./date.mjs";
import { normalizeMongolianPhone } from "./phone.mjs";
import { classifyRow } from "./rows.mjs";

const MODERN_DATE_MIN = "2015-01-01";
const MODERN_DATE_MAX = "2035-12-31";

function isValidName(value) {
  if (typeof value !== "string") return false;
  const length = value.normalize("NFKC").trim().length;
  return length >= 2 && length <= 160;
}

function dataRows(sheet, segment) {
  const rows = [];
  for (let rowNumber = segment.startRow; rowNumber <= segment.endRow; rowNumber += 1) {
    const row = sheet.values[rowNumber - 1] ?? [];
    if (classifyRow(row).type === "data") rows.push({ rowNumber, row });
  }
  return rows;
}

function uniqueSignal(signals, semantic) {
  const candidates = signals?.[semantic] ?? [];
  return candidates.length === 1 ? candidates[0].index : null;
}

function effectiveSignals(segment, inheritedSignals) {
  const direct = segment.fieldSignals ?? {};
  return Object.keys(direct).length ? direct : inheritedSignals;
}

function evidenceBase(segment, rows) {
  return {
    sourceRows: segment.endRow - segment.startRow + 1,
    dataCandidateRows: rows.length,
    headerRows: segment.headerRows?.length ?? 0,
  };
}

function asReview(segment, { reason, reviewClass, proposedEntities = [], decisionEvidence = {}, proposedMapping = null }) {
  const result = {
    ...segment,
    disposition: "review",
    reason,
    reviewClass,
    proposedEntities,
    decisionEvidence,
  };
  if (proposedMapping) result.proposedMapping = proposedMapping;
  return result;
}

function customerDecision(sheet, segment, signals) {
  const rows = dataRows(sheet, segment);
  const nameIndex = uniqueSignal(signals, "customer_name");
  const phoneIndex = uniqueSignal(signals, "phone");
  if (nameIndex === null || phoneIndex === null || rows.length === 0) {
    return asReview(segment, {
      reason: "mvp_customer_identity_layout_review_required",
      reviewClass: "mvp_manual_review",
      proposedEntities: ["customers"],
      decisionEvidence: {
        ...evidenceBase(segment, rows),
        uniqueNameColumn: nameIndex !== null,
        uniquePhoneColumn: phoneIndex !== null,
      },
    });
  }

  const validNameRows = rows.filter(({ row }) => isValidName(row[nameIndex])).length;
  const validPhoneRows = rows.filter(({ row }) => normalizeMongolianPhone(row[phoneIndex]).state === "valid").length;
  const minimumRequired = Math.ceil(rows.length * 0.8);
  if (validNameRows < minimumRequired || validPhoneRows < minimumRequired) {
    return asReview(segment, {
      reason: "mvp_customer_identity_quality_review_required",
      reviewClass: "mvp_manual_review",
      proposedEntities: ["customers"],
      decisionEvidence: {
        ...evidenceBase(segment, rows),
        validNameRows,
        validPhoneRows,
      },
      proposedMapping: {
        entity: "customers",
        mode: "rows",
        columns: { fullName: nameIndex, phone: phoneIndex },
      },
    });
  }

  const columns = {
    fullName: { index: nameIndex, parser: "text", required: true },
    phone: { index: phoneIndex, parser: "phone", required: true },
  };
  const noteIndex = uniqueSignal(signals, "note");
  if (noteIndex !== null) columns.notes = { index: noteIndex, parser: "text", required: false };
  return {
    segmentId: segment.segmentId,
    startRow: segment.startRow,
    endRow: segment.endRow,
    disposition: "import",
    entity: "customers",
    mode: "rows",
    columns,
    decision: "high_confidence_customer_name_and_phone",
    decisionEvidence: {
      ...evidenceBase(segment, rows),
      validNameRows,
      validPhoneRows,
    },
  };
}

function serviceDecision(sheet, segment, signals) {
  const rows = dataRows(sheet, segment);
  const serviceIndex = uniqueSignal(signals, "service");
  const validNameRows = serviceIndex === null ? 0 : rows.filter(({ row }) => isValidName(row[serviceIndex])).length;
  const minimumRequired = Math.ceil(rows.length * 0.95);
  if (serviceIndex === null || rows.length < 3 || validNameRows < minimumRequired) {
    return asReview(segment, {
      reason: "mvp_service_layout_review_required",
      reviewClass: "mvp_manual_review",
      proposedEntities: ["services"],
      decisionEvidence: {
        ...evidenceBase(segment, rows),
        uniqueServiceColumn: serviceIndex !== null,
        validNameRows,
      },
    });
  }

  return {
    segmentId: segment.segmentId,
    startRow: segment.startRow,
    endRow: segment.endRow,
    disposition: "import",
    entity: "services",
    mode: "rows",
    columns: {
      name: { index: serviceIndex, parser: "service", required: true },
    },
    decision: "high_confidence_service_name_column",
    decisionEvidence: {
      ...evidenceBase(segment, rows),
      validNameRows,
      defaultPriceDeferred: true,
      deterministicCodeGenerationRequired: true,
    },
  };
}

function modernDate(value) {
  const outcome = parseLegacyDate(value, { textOrder: "DMY" });
  return outcome.state === "valid" && outcome.value >= MODERN_DATE_MIN && outcome.value <= MODERN_DATE_MAX;
}

function packageDecision(sheet, segment, signals) {
  const rows = dataRows(sheet, segment);
  const identity = {
    customerRef: uniqueSignal(signals, "customer_name"),
    packageRef: uniqueSignal(signals, "package"),
    purchasedOn: uniqueSignal(signals, "date"),
    phone: uniqueSignal(signals, "phone"),
    staffRef: uniqueSignal(signals, "staff"),
    sourceIdentifier: uniqueSignal(signals, "identifier"),
    notes: uniqueSignal(signals, "note"),
  };
  const identityColumns = new Set(Object.values(identity).filter((index) => index !== null));
  const width = rows.reduce((maximum, { row }) => Math.max(maximum, row.length), 0);
  const columnProfiles = [];
  for (let columnIndex = 0; columnIndex < width; columnIndex += 1) {
    let nonblank = 0;
    let modernDates = 0;
    for (const { row } of rows) {
      const value = row[columnIndex];
      if (value === null || value === undefined || value === "") continue;
      nonblank += 1;
      if (modernDate(value)) modernDates += 1;
    }
    if (nonblank) columnProfiles.push({ columnIndex, nonblank, modernDates });
  }

  const identityFloor = Math.max(-1, ...[identity.customerRef, identity.packageRef, identity.purchasedOn].filter((index) => index !== null));
  const usageColumns = columnProfiles
    .filter((profile) => (
      profile.columnIndex > identityFloor
      && !identityColumns.has(profile.columnIndex)
      && profile.modernDates > 0
      && profile.modernDates / profile.nonblank >= 0.6
    ))
    .map((profile) => ({ columnIndex: profile.columnIndex, parser: "date", targetField: "usedAt" }));
  const usageSet = new Set(usageColumns.map(({ columnIndex }) => columnIndex));
  const unclassifiedNonblankColumns = columnProfiles
    .filter((profile) => !identityColumns.has(profile.columnIndex) && !usageSet.has(profile.columnIndex))
    .map((profile) => profile.columnIndex);

  let rowsWithCandidateUsage = 0;
  let candidateUsageCells = 0;
  let invalidCandidateUsageCells = 0;
  for (const { row } of rows) {
    let rowHasUsage = false;
    for (const { columnIndex } of usageColumns) {
      const value = row[columnIndex];
      if (value === null || value === undefined || value === "") continue;
      rowHasUsage = true;
      candidateUsageCells += 1;
      if (!modernDate(value)) invalidCandidateUsageCells += 1;
    }
    if (rowHasUsage) rowsWithCandidateUsage += 1;
  }

  const layoutReady = identity.customerRef !== null
    && identity.packageRef !== null
    && identity.purchasedOn !== null
    && usageColumns.length > 0;
  const proposedMapping = layoutReady ? {
    entity: "package_contracts",
    childEntity: "package_redemptions",
    mode: "wide_package",
    headerRow: segment.headerRows?.[0] ?? segment.startRow,
    dataStartRow: Math.min(segment.endRow, (segment.headerRows?.[0] ?? segment.startRow) + 1),
    identityColumns: Object.fromEntries(Object.entries(identity).filter(([, index]) => index !== null)),
    usageColumns,
    unclassifiedNonblankColumns,
    entitlementQuantityPolicy: "owner_confirmation_required",
  } : null;

  return asReview(segment, {
    reason: layoutReady
      ? "mvp_package_entitlement_quantity_review_required"
      : "mvp_package_layout_review_required",
    reviewClass: "mvp_manual_review",
    proposedEntities: ["customers", "package_contracts", "customer_entitlements", "package_redemptions"],
    decisionEvidence: {
      ...evidenceBase(segment, rows),
      uniqueCustomerColumn: identity.customerRef !== null,
      uniquePackageColumn: identity.packageRef !== null,
      uniquePurchaseDateColumn: identity.purchasedOn !== null,
      candidateUsageColumns: usageColumns.length,
      candidateUsageCells,
      invalidCandidateUsageCells,
      rowsWithCandidateUsage,
      rowsWithoutCandidateUsage: rows.length - rowsWithCandidateUsage,
      unclassifiedNonblankColumns: unclassifiedNonblankColumns.length,
    },
    proposedMapping,
  });
}

function sessionDecision(sheet, segment, signals) {
  const rows = dataRows(sheet, segment);
  const proposedColumns = Object.fromEntries(
    ["customer_name", "phone", "date", "service", "staff", "note"]
      .map((semantic) => [semantic, uniqueSignal(signals, semantic)])
      .filter(([, index]) => index !== null),
  );
  return asReview(segment, {
    reason: "mvp_session_customer_identity_or_layout_review_required",
    reviewClass: "mvp_manual_review",
    proposedEntities: ["customers", "service_sessions"],
    decisionEvidence: {
      ...evidenceBase(segment, rows),
      proposedColumnCount: Object.keys(proposedColumns).length,
      phoneIdentityAvailable: proposedColumns.phone !== undefined,
    },
    proposedMapping: Object.keys(proposedColumns).length ? {
      entity: "service_sessions",
      mode: "rows",
      columns: proposedColumns,
    } : null,
  });
}

function fixedReview(segment, sheet, { reason, reviewClass = "deferred", proposedEntities = [] }) {
  const rows = dataRows(sheet, segment);
  return asReview(segment, {
    reason,
    reviewClass,
    proposedEntities,
    decisionEvidence: evidenceBase(segment, rows),
  });
}

function decideSegment({ category, sheet, segment, inheritedSignals }) {
  const signals = effectiveSignals(segment, inheritedSignals);
  switch (category) {
    case "contacts":
      return customerDecision(sheet, segment, signals);
    case "price_list":
      return serviceDecision(sheet, segment, signals);
    case "packages":
      return packageDecision(sheet, segment, signals);
    case "service_ledger":
      return sessionDecision(sheet, segment, signals);
    case "attendance_schedule":
      return fixedReview(segment, sheet, {
        reason: "mvp_staff_auth_identity_review_required",
        reviewClass: "mvp_manual_review",
        proposedEntities: ["staff_profiles", "service_sessions"],
      });
    case "staff_compensation":
      return fixedReview(segment, sheet, {
        reason: "deferred_payroll_and_staff_auth_identity_required",
        proposedEntities: ["staff_profiles"],
      });
    case "sales_income":
      return fixedReview(segment, sheet, { reason: "deferred_finance_sales_out_of_mvp" });
    case "inventory":
      return fixedReview(segment, sheet, { reason: "deferred_inventory_out_of_mvp" });
    case "expenses":
      return fixedReview(segment, sheet, { reason: "deferred_expenses_out_of_mvp" });
    case "barter":
      return fixedReview(segment, sheet, { reason: "deferred_barter_out_of_mvp" });
    default:
      return fixedReview(segment, sheet, { reason: "deferred_partner_or_unclassified_out_of_mvp" });
  }
}

function buildSheetMapping(snapshotSheet, draftSheet) {
  let inheritedSignals = {};
  const segments = draftSheet.segments.map((segment) => {
    if (segment.disposition === "skip") return segment;
    const decided = decideSegment({
      category: draftSheet.category,
      sheet: snapshotSheet,
      segment,
      inheritedSignals,
    });
    if ((segment.headerRows?.length ?? 0) > 0 && Object.keys(segment.fieldSignals ?? {}).length > 0) {
      inheritedSignals = segment.fieldSignals;
    }
    return decided;
  });
  return { sheetIndex: draftSheet.sheetIndex, category: draftSheet.category, segments };
}

export function summarizeContentAwareMapping(mapping) {
  const summary = {
    segments: { total: 0, import: 0, skip: 0, review: 0 },
    rows: { total: 0, import: 0, skip: 0, review: 0 },
    reviewClasses: {},
    reviewReasons: {},
    importEntities: {},
  };
  for (const sheet of mapping.sheets ?? []) {
    for (const segment of sheet.segments ?? []) {
      const rows = segment.endRow - segment.startRow + 1;
      summary.segments.total += 1;
      summary.segments[segment.disposition] += 1;
      summary.rows.total += rows;
      summary.rows[segment.disposition] += rows;
      if (segment.disposition === "review") {
        summary.reviewClasses[segment.reviewClass] = (summary.reviewClasses[segment.reviewClass] ?? 0) + 1;
        summary.reviewReasons[segment.reason] = (summary.reviewReasons[segment.reason] ?? 0) + 1;
      }
      if (segment.disposition === "import") {
        summary.importEntities[segment.entity] = (summary.importEntities[segment.entity] ?? 0) + 1;
      }
    }
  }
  return summary;
}

export function buildContentAwareMapping(snapshot) {
  const draft = buildDraftMapping(snapshot);
  const mapping = {
    version: 2,
    status: "draft",
    purpose: "cryo_erp_mvp_content_aware_import",
    decisionPolicyVersion: 1,
    workbookSha256: snapshot.fileSha256,
    sheets: draft.sheets.map((draftSheet) => {
      const snapshotSheet = snapshot.sheets.find((sheet) => sheet.index === draftSheet.sheetIndex);
      if (!snapshotSheet) {
        const error = new Error("draft_sheet_missing_from_snapshot");
        error.code = "draft_sheet_missing_from_snapshot";
        throw error;
      }
      return buildSheetMapping(snapshotSheet, draftSheet);
    }),
  };
  const validation = validateMapping(mapping, {
    workbookSha256: snapshot.fileSha256,
    sheetCount: snapshot.sheets.length,
    sheetRowCounts: snapshot.sheets.map((sheet) => sheet.values.length),
  });
  if (!validation.structurallyValid) {
    const error = new Error("content_mapping_internal_validation_failed");
    error.code = "content_mapping_internal_validation_failed";
    throw error;
  }
  return mapping;
}
