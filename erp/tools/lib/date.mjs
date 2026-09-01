const DAY_MS = 86_400_000;

function pad(value, width = 2) {
  return String(value).padStart(width, "0");
}

function blank() {
  return { state: "blank", reason: "blank" };
}

function invalid(reason) {
  return { state: "invalid", reason };
}

function ambiguous(reason) {
  return { state: "ambiguous", reason };
}

function validDateParts(year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
  if (![year, month, day, hour, minute, second, millisecond].every(Number.isInteger)) return invalid("non_integer_date_part");
  if (year < 1900 || year > 2200) return invalid("year_out_of_range");
  if (month < 1 || month > 12) return invalid("month_out_of_range");
  if (day < 1 || day > 31) return invalid("day_out_of_range");
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59 || millisecond < 0 || millisecond > 999) {
    return invalid("time_out_of_range");
  }

  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day ||
    probe.getUTCHours() !== hour ||
    probe.getUTCMinutes() !== minute ||
    probe.getUTCSeconds() !== second
  ) {
    return invalid("invalid_calendar_date");
  }

  const datePart = `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
  if (hour === 0 && minute === 0 && second === 0 && millisecond === 0) {
    return { state: "valid", reason: null, value: datePart, precision: "date" };
  }

  const timePart = `${pad(hour)}:${pad(minute)}:${pad(second)}${millisecond ? `.${pad(millisecond, 3)}` : ""}`;
  return { state: "valid", reason: null, value: `${datePart}T${timePart}`, precision: "local_datetime" };
}

export function parseExcelSerial(serial, { dateSystem = "1900" } = {}) {
  if (typeof serial !== "number" || !Number.isFinite(serial)) return invalid("not_finite_excel_serial");
  if (serial < 0 || serial > 2_958_465) return invalid("excel_serial_out_of_range");

  const wholeDays = Math.floor(serial);
  if (dateSystem === "1900" && wholeDays === 60) return invalid("excel_1900_leap_day_bug");
  if (!['1900', '1904'].includes(dateSystem)) return invalid("unsupported_excel_date_system");

  const fractionMs = Math.round((serial - wholeDays) * DAY_MS);
  let epochMs;
  if (dateSystem === "1904") {
    epochMs = Date.UTC(1904, 0, 1) + wholeDays * DAY_MS + fractionMs;
  } else {
    const adjustedDays = wholeDays > 60 ? wholeDays - 1 : wholeDays;
    epochMs = Date.UTC(1899, 11, 31) + adjustedDays * DAY_MS + fractionMs;
  }

  const date = new Date(epochMs);
  return validDateParts(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  );
}

export function parseLegacyDate(value, { dateSystem = "1900", textOrder = null, allowNumericTextSerial = false } = {}) {
  if (value === null || value === undefined || value === "") return blank();
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return invalid("invalid_date_object");
    return validDateParts(
      value.getUTCFullYear(),
      value.getUTCMonth() + 1,
      value.getUTCDate(),
      value.getUTCHours(),
      value.getUTCMinutes(),
      value.getUTCSeconds(),
      value.getUTCMilliseconds(),
    );
  }
  if (typeof value === "number") return parseExcelSerial(value, { dateSystem });

  const text = String(value).normalize("NFKC").trim();
  if (!text) return blank();
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    return allowNumericTextSerial ? parseExcelSerial(Number(text), { dateSystem }) : ambiguous("numeric_text_requires_serial_approval");
  }

  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (match) {
    return validDateParts(
      Number(match[1]), Number(match[2]), Number(match[3]),
      Number(match[4] ?? 0), Number(match[5] ?? 0), Number(match[6] ?? 0), 0,
    );
  }

  match = text.match(/^(\d{4})\s*оны\s*(\d{1,2})\s*(?:сар(?:ын)?|сарын)\s*(\d{1,2})(?:\s*(?:өдөр)?)?$/iu);
  if (match) return validDateParts(Number(match[1]), Number(match[2]), Number(match[3]));

  match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (!match) return invalid("unsupported_date_text");

  const first = Number(match[1]);
  const second = Number(match[2]);
  const year = Number(match[3]);
  if (first <= 12 && second <= 12 && textOrder === null) return ambiguous("day_month_order_required");

  const order = textOrder ?? (first > 12 ? "DMY" : second > 12 ? "MDY" : null);
  if (!order) return ambiguous("day_month_order_required");
  if (!['DMY', 'MDY'].includes(order)) return invalid("unsupported_text_date_order");

  const day = order === "DMY" ? first : second;
  const month = order === "DMY" ? second : first;
  const result = validDateParts(year, month, day);
  return result.state === "valid" ? { ...result, assumption: order } : result;
}
