const HEADER_PATTERNS = [
  /^(огноо|date|өдөр|day|сар|month)$/iu,
  /(?:үйлчлүүлэгч|харилцагч|customer|client).*(?:нэр|name)|^(нэр|name)$/iu,
  /утас|phone|mobile|contact/iu,
  /үйлчилгээ|service|эмчилгээ|treatment|product|бүтээгдэхүүн/iu,
  /багц|package/iu,
  /тоо|quantity|qty|ширхэг/iu,
  /үнэ|price|дүн|amount|орлого|income|борлуулалт|sale/iu,
  /төлбөр|payment|бэлэн|cash|данс|bank|qpay|карт|card/iu,
  /ажилтан|staff|employee|therapist|эмч/iu,
  /тэмдэглэл|тайлбар|note|comment/iu,
  /төлөв|status/iu,
];

const SUBTOTAL_PATTERN = /^(?:нийт|дэд\s*дүн|subtotal|grand\s*total|total|баланс|үлдэгдэл)(?:\s|:|$)/iu;

export function normalizeLabel(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("mn-MN");
}

export function detectHeaderSemantic(value) {
  const label = normalizeLabel(value);
  if (!label || label.length > 120) return null;
  const rules = [
    ["phone", /утас|phone|mobile|contact/iu],
    ["customer_name", /(?:үйлчлүүлэгч|харилцагч|customer|client).*(?:нэр|name)|^(?:нэр|name)$/iu],
    ["date", /^(?:огноо|date|өдөр|day|сар|month|он|year)$|(?:огноо|date)/iu],
    ["service", /үйлчилгээ|service|эмчилгээ|treatment|product|бүтээгдэхүүн/iu],
    ["package", /багц|package/iu],
    ["quantity", /^(?:тоо|quantity|qty|ширхэг)|(?:тоо|quantity|qty|ширхэг)$/iu],
    ["discount", /хөнгөлөлт|discount/iu],
    ["net_amount", /цэвэр.*(?:дүн|орлого)|net.*amount/iu],
    ["gross_amount", /нийт.*(?:дүн|орлого)|gross.*amount|борлуулалт|income/iu],
    ["unit_price", /нэгж.*үнэ|unit.*price|^үнэ$|^price$/iu],
    ["payment_method", /төлбөр.*(?:төрөл|хэлбэр)|payment.*method|бэлэн|cash|данс|bank|qpay|карт|card/iu],
    ["payment_amount", /төлбөр|payment|paid/iu],
    ["staff", /ажилтан|staff|employee|therapist|эмч/iu],
    ["status", /төлөв|status/iu],
    ["note", /тэмдэглэл|тайлбар|note|comment/iu],
    ["expense", /зардал|expense|cost/iu],
    ["inventory", /азот|nitrogen|үлдэгдэл|stock|inventory/iu],
    ["identifier", /(?:баримт|захиалга|гүйлгээ|invoice|receipt|order|transaction).*(?:№|no|id|дугаар)|^id$/iu],
  ];

  for (const [semantic, pattern] of rules) if (pattern.test(label)) return semantic;
  return null;
}

export function classifyRow(values) {
  const cells = Array.isArray(values) ? values : [];
  const populated = cells.filter((value) => value !== null && value !== undefined && value !== "");
  if (populated.length === 0) return { type: "blank", confidence: 1, reasons: ["no_populated_cells"] };

  const textCells = populated.filter((value) => typeof value === "string").map(normalizeLabel).filter(Boolean);
  const numericCount = populated.filter((value) => typeof value === "number" && Number.isFinite(value)).length;
  const firstText = textCells[0] ?? "";
  if (firstText && SUBTOTAL_PATTERN.test(firstText)) {
    return { type: "subtotal", confidence: 0.98, reasons: ["subtotal_label"] };
  }

  const headerHits = textCells.filter((label) => HEADER_PATTERNS.some((pattern) => pattern.test(label))).length;
  if (headerHits >= 2 || (headerHits === 1 && numericCount === 0 && populated.length === 1)) {
    return { type: "header", confidence: headerHits >= 2 ? 0.95 : 0.75, reasons: [`header_hits:${headerHits}`] };
  }

  if (populated.length === 1 && typeof populated[0] === "string" && normalizeLabel(populated[0]).length > 40) {
    return { type: "note", confidence: 0.8, reasons: ["single_long_text"] };
  }

  return { type: "data", confidence: 0.6, reasons: ["default_data_candidate"] };
}

export function findHeaderCandidates(rows, { scanRows = 30 } = {}) {
  return rows
    .slice(0, scanRows)
    .map((row, index) => ({ row: index + 1, ...classifyRow(row) }))
    .filter((entry) => entry.type === "header")
    .sort((left, right) => right.confidence - left.confidence || left.row - right.row);
}
