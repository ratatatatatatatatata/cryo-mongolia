export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function formatMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("mn-MN", {
    style: "currency",
    currency: "MNT",
    maximumFractionDigits: 0,
  }).format(amount);
}

function zonedDateParts(value, timeZone = "Asia/Ulaanbaatar") {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function formatDate(value, options = {}) {
  if (!value) return "—";
  const parts = zonedDateParts(value, options.timeZone);
  if (!parts) return "—";
  const date = `${parts.year}.${parts.month}.${parts.day}`;
  return options.hour || options.minute ? `${date} ${parts.hour}:${parts.minute}` : date;
}

export function businessDate(value = new Date(), timeZone = "Asia/Ulaanbaatar") {
  const parts = zonedDateParts(value, timeZone);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : "";
}

export function zonedLocalDateTimeToIso(value, timeZone = "Asia/Ulaanbaatar") {
  const match = String(value ?? "").match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "00"] = match;
  const expected = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
    second: Number(secondText),
  };
  const wallClockUtc = Date.UTC(
    expected.year,
    expected.month - 1,
    expected.day,
    expected.hour,
    expected.minute,
    expected.second,
  );
  const normalized = new Date(wallClockUtc);
  if (
    normalized.getUTCFullYear() !== expected.year
    || normalized.getUTCMonth() + 1 !== expected.month
    || normalized.getUTCDate() !== expected.day
    || normalized.getUTCHours() !== expected.hour
    || normalized.getUTCMinutes() !== expected.minute
    || normalized.getUTCSeconds() !== expected.second
  ) return null;

  let instant = wallClockUtc;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const observed = zonedDateParts(new Date(instant), timeZone);
    if (!observed) return null;
    const observedWallClock = Date.UTC(
      Number(observed.year),
      Number(observed.month) - 1,
      Number(observed.day),
      Number(observed.hour),
      Number(observed.minute),
      expected.second,
    );
    const correction = wallClockUtc - observedWallClock;
    instant += correction;
    if (correction === 0) break;
  }

  const verified = zonedDateParts(new Date(instant), timeZone);
  if (!verified) return null;
  if (
    Number(verified.year) !== expected.year
    || Number(verified.month) !== expected.month
    || Number(verified.day) !== expected.day
    || Number(verified.hour) !== expected.hour
    || Number(verified.minute) !== expected.minute
  ) return null;
  return new Date(instant).toISOString();
}

export function fullName(person) {
  return [person?.lastName, person?.firstName].filter(Boolean).join(" ") || "Нэргүй";
}

export function initials(person) {
  const parts = [person?.lastName, person?.firstName].filter(Boolean);
  return parts.map((part) => [...part][0]).join("").slice(0, 2).toUpperCase() || "?";
}

export function remainingCount(entitlement) {
  return Math.max(0, Number(entitlement?.totalCount ?? 0) - Number(entitlement?.usedCount ?? 0));
}

export function maskPhone(phone) {
  const value = String(phone ?? "").replace(/\s/g, "");
  if (value.length < 4) return value || "—";
  return `${value.slice(0, 2)}•• ••${value.slice(-2)}`;
}

export function debounce(callback, delay = 250) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => callback(...args), delay);
  };
}

export function deepClone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function compactError(error, fallback = "Үйлдлийг гүйцэтгэж чадсангүй.") {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
