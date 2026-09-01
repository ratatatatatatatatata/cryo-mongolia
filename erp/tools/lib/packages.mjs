import { buildSourceKey, columnName } from "./hash.mjs";

function assertColumnIndex(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative column index`);
}

export function buildWidePackageManifest({
  fileSha256,
  sheetIndex,
  headerRow,
  dataStartRow,
  dataEndRow,
  identityColumns,
  usageColumns,
}) {
  if (!Number.isInteger(headerRow) || headerRow < 1) throw new TypeError("headerRow must be 1-based");
  if (!Number.isInteger(dataStartRow) || dataStartRow <= headerRow) throw new TypeError("dataStartRow must follow headerRow");
  if (!Number.isInteger(dataEndRow) || dataEndRow < dataStartRow) throw new TypeError("dataEndRow must be at or after dataStartRow");
  if (!identityColumns || typeof identityColumns !== "object" || Array.isArray(identityColumns)) {
    throw new TypeError("identityColumns must be an object");
  }
  if (!Array.isArray(usageColumns) || usageColumns.length === 0) throw new TypeError("usageColumns must be a non-empty array");

  const identityFields = Object.entries(identityColumns).map(([targetField, columnIndex]) => {
    assertColumnIndex(columnIndex, `identityColumns.${targetField}`);
    return { targetField, sourceColumnIndex: columnIndex, sourceColumn: columnName(columnIndex) };
  });
  const usageCells = usageColumns.map((entry, index) => {
    const columnIndex = typeof entry === "number" ? entry : entry.columnIndex;
    assertColumnIndex(columnIndex, `usageColumns[${index}]`);
    return {
      sourceColumnIndex: columnIndex,
      sourceColumn: columnName(columnIndex),
      targetEntity: "package_redemptions",
      targetField: typeof entry === "number" ? "used_at" : entry.targetField ?? "used_at",
      parser: typeof entry === "number" ? "date" : entry.parser ?? "date",
    };
  });

  const uniqueColumns = new Set(usageCells.map((entry) => entry.sourceColumnIndex));
  if (uniqueColumns.size !== usageCells.length) throw new TypeError("usageColumns contains duplicates");

  return {
    version: 1,
    state: "review_required",
    source: { fileSha256, sheetIndex, headerRow, dataStartRow, dataEndRow },
    targetEntity: "package_redemptions",
    identityFields,
    usageCells,
    reviewRules: [
      "confirm_each_usage_column_semantic",
      "blank_usage_cell_is_not_zero",
      "do_not_treat_redemption_as_new_revenue",
    ],
  };
}

export function unpivotWidePackageRows({ rows, manifest, approved = false }) {
  if (!approved || manifest?.state !== "approved") {
    throw new Error("wide package manifest must be explicitly approved before unpivot");
  }

  const records = [];
  const startIndex = manifest.source.dataStartRow - 1;
  const endIndex = manifest.source.dataEndRow - 1;
  for (let rowIndex = startIndex; rowIndex <= endIndex; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const identity = Object.fromEntries(
      manifest.identityFields.map((entry) => [entry.targetField, row[entry.sourceColumnIndex] ?? null]),
    );

    for (const usage of manifest.usageCells) {
      const rawUsageValue = row[usage.sourceColumnIndex];
      if (rawUsageValue === null || rawUsageValue === undefined || rawUsageValue === "") continue;
      const cell = `${usage.sourceColumn}${rowIndex + 1}`;
      records.push({
        sourceKey: buildSourceKey({
          fileSha256: manifest.source.fileSha256,
          sheetIndex: manifest.source.sheetIndex,
          row: rowIndex + 1,
          cell,
        }),
        identity,
        targetField: usage.targetField,
        parser: usage.parser,
        rawUsageValue,
      });
    }
  }
  return records;
}
