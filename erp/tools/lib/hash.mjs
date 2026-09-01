import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CELL_PATTERN = /^[A-Z]{1,3}[1-9][0-9]*$/;

export function sha256Text(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);

  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

export function columnName(columnIndex) {
  if (!Number.isInteger(columnIndex) || columnIndex < 0) {
    throw new TypeError("columnIndex must be a non-negative integer");
  }

  let current = columnIndex + 1;
  let label = "";
  while (current > 0) {
    current -= 1;
    label = String.fromCharCode(65 + (current % 26)) + label;
    current = Math.floor(current / 26);
  }
  return label;
}

export function buildSourceKey({ fileSha256, sheetIndex, row, cell = null }) {
  if (!SHA256_PATTERN.test(fileSha256)) throw new TypeError("fileSha256 must be a lowercase SHA-256 hex digest");
  if (!Number.isInteger(sheetIndex) || sheetIndex < 0) throw new TypeError("sheetIndex must be a non-negative integer");
  if (!Number.isInteger(row) || row < 1) throw new TypeError("row must be a 1-based positive integer");

  const normalizedCell = cell === null || cell === "" ? "-" : String(cell).toUpperCase();
  if (normalizedCell !== "-" && !CELL_PATTERN.test(normalizedCell)) {
    throw new TypeError("cell must be an A1 cell reference");
  }

  return `${fileSha256}:${sheetIndex}:${row}:${normalizedCell}`;
}

export function sourceKeyDigest(parts) {
  return sha256Text(buildSourceKey(parts));
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const entries = Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}
