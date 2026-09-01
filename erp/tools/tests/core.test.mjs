import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildServiceAliasCandidates, canonicalizeServiceLabel } from "../lib/aliases.mjs";
import { classifyAmount } from "../lib/amount.mjs";
import { parseExcelSerial, parseLegacyDate } from "../lib/date.mjs";
import { buildSaleCandidateFingerprint, clusterDuplicateCandidates } from "../lib/duplicates.mjs";
import { buildSourceKey, sha256File, sha256Text } from "../lib/hash.mjs";
import { mappingDigest, validateMapping } from "../lib/mapping.mjs";
import { buildWidePackageManifest, unpivotWidePackageRows } from "../lib/packages.mjs";
import { normalizeMongolianPhone } from "../lib/phone.mjs";
import { buildReconciliationSummary } from "../lib/reconcile.mjs";
import { classifyRow, detectHeaderSemantic } from "../lib/rows.mjs";

const FILE_HASH = "a".repeat(64);
const SYNTHETIC_PHONE = ["88", "11", "22", "33"].join("");
const SECOND_SYNTHETIC_PHONE = ["99", "11", "22", "33"].join("");

test("file SHA-256 and source key are deterministic", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cryo-import-hash-"));
  const file = join(directory, "fixture.txt");
  await writeFile(file, "deterministic fixture", { flag: "wx" });
  assert.equal(await sha256File(file), sha256Text("deterministic fixture"));
  assert.equal(buildSourceKey({ fileSha256: FILE_HASH, sheetIndex: 2, row: 7, cell: "b7" }), `${FILE_HASH}:2:7:B7`);
});

test("Mongolian phone normalization quarantines ambiguity", () => {
  assert.deepEqual(normalizeMongolianPhone(`+976 ${SYNTHETIC_PHONE}`), {
    state: "valid", reason: null, national: SYNTHETIC_PHONE, e164: `+976${SYNTHETIC_PHONE}`,
  });
  assert.equal(normalizeMongolianPhone(`${SYNTHETIC_PHONE} / ${SECOND_SYNTHETIC_PHONE}`).reason, "multiple_phone_candidates");
  assert.equal(normalizeMongolianPhone(`0${SYNTHETIC_PHONE}`).reason, "ambiguous_trunk_prefix");
  assert.equal(normalizeMongolianPhone("not-a-phone").state, "quarantine");
});

test("Excel serial and explicit text dates fail closed", () => {
  assert.equal(parseExcelSerial(1).value, "1900-01-01");
  assert.equal(parseExcelSerial(59).value, "1900-02-28");
  assert.equal(parseExcelSerial(60).reason, "excel_1900_leap_day_bug");
  assert.equal(parseExcelSerial(61).value, "1900-03-01");
  assert.equal(parseLegacyDate("05/06/2026").state, "ambiguous");
  assert.equal(parseLegacyDate("05/06/2026", { textOrder: "DMY" }).value, "2026-06-05");
  assert.equal(parseLegacyDate("2026-02-30").state, "invalid");
});

test("amount classification never guesses ambiguous decimals", () => {
  assert.equal(classifyAmount("1,234,567").canonical, "1234567");
  assert.equal(classifyAmount("1234,50").state, "quarantine");
  assert.equal(classifyAmount("1234,50", { currency: "USD", decimalSeparator: ",", maxScale: 2 }).canonical, "1234.50");
  assert.equal(classifyAmount("=A1*B1").state, "formula");
  assert.equal(classifyAmount("#VALUE!").state, "invalid");
  assert.equal(classifyAmount(Number.MAX_SAFE_INTEGER + 1).reason, "unsafe_numeric_amount");
});

test("header and subtotal classification is conservative", () => {
  assert.equal(classifyRow(["Огноо", "Үйлчилгээ", "Нийт дүн"]).type, "header");
  assert.equal(classifyRow(["НИЙТ", null, 100]).type, "subtotal");
  assert.equal(classifyRow([null, null]).type, "blank");
  assert.equal(detectHeaderSemantic("Утасны дугаар"), "phone");
});

test("wide package unpivot requires explicit approval", () => {
  const manifest = buildWidePackageManifest({
    fileSha256: FILE_HASH,
    sheetIndex: 8,
    headerRow: 3,
    dataStartRow: 4,
    dataEndRow: 4,
    identityColumns: { customerRef: 0, packageRef: 1 },
    usageColumns: [{ columnIndex: 4, parser: "date", targetField: "usedAt" }],
  });
  assert.equal(manifest.state, "review_required");
  assert.throws(() => unpivotWidePackageRows({ rows: [], manifest }), /explicitly approved/);
  const approved = { ...manifest, state: "approved" };
  const rows = [[], [], [], ["C-1", "P-1", null, null, 45_000]];
  const records = unpivotWidePackageRows({ rows, manifest: approved, approved: true });
  assert.equal(records.length, 1);
  assert.match(records[0].sourceKey, /:8:4:E4$/);
});

test("service aliases and duplicates remain review candidates", () => {
  assert.equal(canonicalizeServiceLabel("  CRYO—Start  "), "cryo start");
  const aliases = buildServiceAliasCandidates([
    { sourceKey: `${FILE_HASH}:0:2:A2`, label: "Service Alpha" },
    { sourceKey: `${FILE_HASH}:0:3:A3`, label: "service-alpha" },
  ]);
  assert.equal(aliases.length, 1);
  assert.equal(aliases[0].decision, "manual_review");
  assert.equal("labels" in aliases[0], false);

  const fingerprint = buildSaleCandidateFingerprint({
    date: "2026-01-01", customerHmac: "customer-token", serviceKey: "service-a", amountCanonical: "100", paymentMethod: "cash",
  });
  const groups = clusterDuplicateCandidates([
    { sourceKey: `${FILE_HASH}:0:2:-`, fingerprint },
    { sourceKey: `${FILE_HASH}:0:3:-`, fingerprint },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].autoMerged, false);
});

test("reconciliation reports pass and fail without exposing totals", () => {
  const passing = buildReconciliationSummary({
    rows: { eligible: 4, imported: 2, quarantined: 1, ignored: 1 },
    sales: { grossMinor: "1000", discountMinor: "100", netMinor: "900", paymentMinor: "800", outstandingMinor: "100" },
    packages: { purchased: 10, used: 4, expired: 1, adjusted: 0, remaining: 5 },
    inventory: { opening: "10", receipts: "5", issues: "3", adjustments: "0", closing: "12" },
  });
  assert.equal(passing.status, "pass");
  assert.equal(JSON.stringify(passing).includes("1000"), false);
  const failing = buildReconciliationSummary({ rows: { eligible: 2, imported: 1, quarantined: 0, ignored: 0 } });
  assert.equal(failing.status, "fail");
});

test("mapping validation requires every sheet profile, exact hash, and complete segment coverage", () => {
  const mapping = {
    version: 2,
    status: "reviewed",
    workbookSha256: FILE_HASH,
    sheets: [{
      sheetIndex: 0,
      segments: [
        {
          segmentId: "sheet-0-table-1",
          startRow: 1,
          endRow: 2,
          disposition: "import",
          entity: "sales",
          mode: "rows",
          columns: { value: { index: 0, parser: "text", required: true } },
        },
        {
          segmentId: "sheet-0-reviewed-skip",
          startRow: 3,
          endRow: 4,
          disposition: "skip",
          reason: "reviewed_out_of_scope",
        },
      ],
    }],
  };
  const source = { workbookSha256: FILE_HASH, sheetCount: 1, sheetRowCounts: [4] };
  assert.equal(validateMapping(mapping, source).valid, true);
  assert.equal(validateMapping(mapping, { ...source, workbookSha256: "b".repeat(64) }).valid, false);
  assert.equal(mappingDigest(mapping), mappingDigest(structuredClone(mapping)));
});

test("mapping validation rejects gaps, overlaps, duplicate segment ids, and unresolved reviews", () => {
  const base = {
    version: 2,
    status: "reviewed",
    workbookSha256: FILE_HASH,
    sheets: [{
      sheetIndex: 0,
      segments: [
        { segmentId: "first", startRow: 1, endRow: 2, disposition: "skip", reason: "verified_blank_rows_only" },
        { segmentId: "second", startRow: 3, endRow: 4, disposition: "skip", reason: "reviewed_out_of_scope" },
      ],
    }],
  };
  const source = { workbookSha256: FILE_HASH, sheetCount: 1, sheetRowCounts: [4] };
  assert.equal(validateMapping(base, source).valid, true);

  const gap = structuredClone(base);
  gap.sheets[0].segments[1].startRow = 4;
  assert.equal(validateMapping(gap, source).issues.some((entry) => entry.code === "segment_coverage_gap"), true);

  const overlap = structuredClone(base);
  overlap.sheets[0].segments[1].startRow = 2;
  assert.equal(validateMapping(overlap, source).issues.some((entry) => entry.code === "segment_overlap_or_out_of_order"), true);

  const duplicate = structuredClone(base);
  duplicate.sheets[0].segments[1].segmentId = "first";
  assert.equal(validateMapping(duplicate, source).issues.some((entry) => entry.code === "duplicate_segment_id"), true);

  const review = structuredClone(base);
  review.status = "draft";
  review.sheets[0].segments[1] = {
    segmentId: "second",
    startRow: 3,
    endRow: 4,
    disposition: "review",
    reason: "content_requires_explicit_mapping",
  };
  const reviewValidation = validateMapping(review, source);
  assert.equal(reviewValidation.structurallyValid, true);
  assert.equal(reviewValidation.valid, false);
  assert.equal(reviewValidation.issues.some((entry) => entry.code === "segment_review_required"), true);
});
