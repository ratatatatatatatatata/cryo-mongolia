function result(state, reason, extra = {}) {
  return { state, reason, ...extra };
}

function normalizeNumberString(value) {
  if (!Number.isFinite(value)) return null;
  if (Object.is(value, -0)) return "0";
  return String(value);
}

export function classifyAmount(
  value,
  { currency = "MNT", decimalSeparator = null, allowNegative = true, maxScale = currency === "MNT" ? 0 : 2 } = {},
) {
  if (value === null || value === undefined || value === "") return result("blank", "blank");
  if (typeof value === "number") {
    const canonical = normalizeNumberString(value);
    if (canonical === null) return result("invalid", "non_finite_number");
    if (Math.abs(value) > Number.MAX_SAFE_INTEGER || /[eE]/.test(canonical)) {
      return result("quarantine", "unsafe_numeric_amount");
    }
    if (!allowNegative && value < 0) return result("invalid", "negative_not_allowed");
    const scale = canonical.includes(".") ? canonical.split(".")[1].length : 0;
    if (scale > maxScale) return result("quarantine", "scale_exceeds_currency_rule");
    return result("valid", null, { canonical, currency, sourceType: "number" });
  }

  let text = String(value).normalize("NFKC").trim();
  if (!text) return result("blank", "blank");
  if (text.startsWith("=")) return result("formula", "formula_requires_cached_value");
  if (/^(#REF!|#DIV\/0!|#VALUE!|#NAME\?|#N\/A|#NUM!|#NULL!)/i.test(text)) return result("invalid", "excel_error");
  if (text.includes("%")) return result("quarantine", "percentage_not_amount");

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1).trim();
  }
  if (negative && !allowNegative) return result("invalid", "negative_not_allowed");

  text = text
    .replace(/(?:MNT|MNТ|₮|төгрөг|төг)\.?/giu, "")
    .replace(/[\s'’]/g, "")
    .trim();
  if (!text) return result("invalid", "currency_without_number");
  if (!/^\d+(?:[.,]\d+)*$/.test(text)) return result("invalid", "unsupported_amount_text");

  const commaCount = (text.match(/,/g) ?? []).length;
  const dotCount = (text.match(/\./g) ?? []).length;
  if (commaCount && dotCount && !decimalSeparator) return result("quarantine", "mixed_separators_require_rule");

  const decideSingleSeparator = (separator, count) => {
    const groups = text.split(separator);
    if (count > 1) {
      if (groups.slice(1).every((group) => group.length === 3)) return { canonical: groups.join(""), scale: 0 };
      if (decimalSeparator === separator && count === 1) return { canonical: groups.join("."), scale: groups[1].length };
      return null;
    }
    if (count === 1) {
      const fractionalLength = groups[1].length;
      if (decimalSeparator === separator) return { canonical: groups.join("."), scale: fractionalLength };
      if (fractionalLength === 3) return { canonical: groups.join(""), scale: 0 };
      return { ambiguous: true };
    }
    return { canonical: text, scale: 0 };
  };

  let parsed;
  if (commaCount && dotCount) {
    const decimal = decimalSeparator;
    if (!['.', ','].includes(decimal)) return result("invalid", "invalid_decimal_separator_rule");
    const grouping = decimal === "." ? "," : ".";
    const groupingPattern = new RegExp(`\\${grouping}`, "g");
    const normalized = text.replace(groupingPattern, "").replace(decimal, ".");
    if ((normalized.match(/\./g) ?? []).length > 1) return result("quarantine", "invalid_separator_layout");
    parsed = { canonical: normalized, scale: normalized.includes(".") ? normalized.split(".")[1].length : 0 };
  } else if (commaCount) parsed = decideSingleSeparator(",", commaCount);
  else if (dotCount) parsed = decideSingleSeparator(".", dotCount);
  else parsed = { canonical: text, scale: 0 };

  if (!parsed) return result("quarantine", "invalid_grouping");
  if (parsed.ambiguous) return result("quarantine", "decimal_or_grouping_ambiguous");
  if (parsed.scale > maxScale) return result("quarantine", "scale_exceeds_currency_rule");

  const unsigned = parsed.canonical.replace(/^0+(?=\d)/, "") || "0";
  const canonical = negative && unsigned !== "0" ? `-${unsigned}` : unsigned;
  return result("valid", null, { canonical, currency, sourceType: "text" });
}
