function blankResult() {
  return { state: "blank", reason: "blank" };
}

function quarantine(reason) {
  return { state: "quarantine", reason };
}

export function normalizeMongolianPhone(value) {
  if (value === null || value === undefined || value === "") return blankResult();
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) {
    return quarantine("unsafe_numeric_phone");
  }

  const text = String(value).normalize("NFKC").trim();
  if (!text) return blankResult();
  if (/[eE][+-]?\d/.test(text)) return quarantine("scientific_notation");

  const delimitedCandidates = text
    .split(/\s*(?:[,;/]|\b(?:or|эсвэл)\b)\s*/iu)
    .map((part) => part.replace(/\D/g, ""))
    .filter((part) => part.length >= 6);
  if (delimitedCandidates.length > 1) return quarantine("multiple_phone_candidates");

  if ((text.match(/\+/g) ?? []).length > 1 || (text.includes("+") && !text.startsWith("+"))) {
    return quarantine("invalid_plus_placement");
  }

  let digits = text.replace(/\D/g, "");
  if (!digits) return quarantine("no_digits");
  if (digits.startsWith("00976")) digits = digits.slice(5);
  else if (digits.startsWith("976") && digits.length === 11) digits = digits.slice(3);

  if (digits.length === 9 && digits.startsWith("0")) return quarantine("ambiguous_trunk_prefix");
  if (digits.length !== 8) return quarantine("unexpected_digit_length");

  return {
    state: "valid",
    reason: null,
    national: digits,
    e164: `+976${digits}`,
  };
}

export function sanitizedPhoneOutcome(result) {
  return { state: result.state, reason: result.reason ?? null };
}
