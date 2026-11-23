/* ══════════════════════════════════════════════════════════════
   Staff assistant — the part that reads what was typed.

   No AI and no network: a command such as
       «Болд маргааш 14:00 cryo cabin»
   is taken apart piece by piece — phone, date, time, service, and
   whatever is left is the customer's name. Nothing here touches the
   database; admin.js decides what to do with the result and asks the
   employee to confirm before anything is written.

   Kept free of DOM and Supabase so it can be tested in plain Node.
   ══════════════════════════════════════════════════════════════ */
import { nameKey, matchesName } from './name-search.js';

const OPEN_HOUR = 9, CLOSE_HOUR = 21;
/* one spelling for Cyrillic and Latin: «крио кабин», "krio kabin" and "Cryo°Cabin™" all meet here */
const key = (value) => nameKey(value).replace(/[^a-z0-9]/g, '');
const pad = (n) => String(n).padStart(2, '0');

/* Shorthand the staff already use in the sheets, by service slug. Written
   the way people type it; key() folds the spellings together. */
const SERVICE_ALIASES = {
  cryocabin: ['cc', 'cryo cabin', 'cabin', 'кабин', 'крио кабин', 'крио', 'cryo'],
  xcryo: ['x cryo', 'икс крио', 'локал', 'local', 'локал крио', 'local cryo'],
  ledpro: ['led', 'led pro', 'лед', 'rl', 'red light', 'улаан гэрэл'],
  oxypro: ['oxy', 'oxy pro', 'окси', 'окси про'],
  zerobody: ['zerobody', 'zb', 'zero', 'зеро', 'зерободи'],
  normatec: ['normatec', 'норматек', 'nor', 'norm'],
  oxygen: ['oxygen', 'хүчилтөрөгч', 'o2'],
};
/* "кабинд", "cabin deer" — a case ending on the device does not change which device it is */
const SERVICE_SUFFIXES = ['', 'd', 't', 'nd', 'ruu', 'deer', 'aar', 'eer'];

/* How each request is recognised: a word that starts with one of these, or
   is exactly one of these. Earlier rows win when a line holds several. */
const INTENTS = [
  ['help', { starts: ['тусламж', 'туслаач'], exact: ['help', 'заавар'] }],
  ['schedule', { starts: ['хуваар', 'huvaar', 'захиалгууд', 'жагсаалт'], exact: [] }],
  ['free', { starts: ['чөлөөт'], exact: ['сул', 'завтай'] }],
  ['balance', { starts: ['багц', 'үлдэгд'], exact: ['үлдсэн'] }],
  ['find', { starts: [], exact: ['хай', 'хайх', 'хайж', 'хайя', 'хайгаад', 'хайгаач', 'find', 'search'] }],
  ['book', { starts: ['захиал', 'бүртг'], exact: [] }],
].map(([name, rule]) => [name, { starts: rule.starts.map(key), exact: rule.exact.map(key) }]);

/* Words that carry no information once the pieces above are taken out.
   «ба» is deliberately not here: typed alone it is far more often the start
   of a name (Бат, Баяр, Батболд) than the word "and". */
const FILLER = new Set(['дээр', 'der', 'д', 'т', 'нэрээр', 'нэр', 'гэж', 'гэдэг', 'цаг', 'цагт', 'цагийн',
  'өдөр', 'өдөрт', 'udur', 'udurt', 'гараг', 'гарагт', 'харуул', 'харуулаач', 'үз', 'үзүүл',
  'байна', 'bn', 'уу', 'юу', 'вэ', 'бэ', 'ямар', 'хэд', 'хэдэн', 'нь', 'өгөөч', 'uguuch', 'өг',
  'ав', 'авъя', 'авах', 'хийж', 'хий', 'хийгээд', 'хийгээч', 'шалга', 'шалгаач', 'хүн', 'хүнийг',
  'үйлчлүүлэгч', 'үйлчлүүлэгчийн', 'төхөөрөмж', 'tuhuurumj', 'шинэ'].map(key));

const WEEKDAYS = Object.fromEntries(
  [['ням', 0], ['даваа', 1], ['мягмар', 2], ['лхагва', 3], ['пүрэв', 4], ['баасан', 5], ['бямба', 6]]
    .map(([name, day]) => [key(name), day]));
/* case endings a name picks up in a sentence, longest first */
const NAME_ENDINGS = ['ийнх', 'ийг', 'ийн', 'тай', 'тэй', 'той', 'аас', 'ээс', 'оос', 'өөс', 'од', 'ад', 'эд', 'өд', 'ын', 'ыг', 'д', 'т', 'г', 'н']
  .map(key).filter((ending, i, all) => ending && all.indexOf(ending) === i).sort((a, b) => b.length - a.length);
const GARAG = key('гараг');
const TODAY = key('today'), TOMORROW = key('tomorrow');

/* today's date in Ulaanbaatar, whatever the computer's own zone is */
export function todayInUlaanbaatar(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function shiftDay(day, offset) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function validDay(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/* a month and day with no year means the next time that date comes round */
function nextMonthDay(m, d, today) {
  const year = Number(today.slice(0, 4));
  const thisYear = validDay(year, m, d);
  if (thisYear && thisYear >= today) return thisYear;
  return validDay(year + 1, m, d) || thisYear;
}

function nextDayOfMonth(d, today) {
  let year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7));
  for (let i = 0; i < 12; i++) {
    const day = validDay(year, month, d);
    if (day && day >= today) return day;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return null;
}

/* staff say "2 цагт" for 14:00 — the centre is closed at two in the morning */
function clock(hour, minute) {
  let h = Number(hour);
  const m = Number(minute || 0);
  if (h >= 1 && h < OPEN_HOUR) h += 12;
  if (!(h >= 0 && h <= 23 && m >= 0 && m <= 59)) return null;
  return `${pad(h)}:${pad(m)}`;
}

export function describeDay(day, today) {
  const label = day === today ? 'өнөөдөр' : day === shiftDay(today, 1) ? 'маргааш' : day === shiftDay(today, 2) ? 'нөгөөдөр' : day === shiftDay(today, -1) ? 'өчигдөр' : '';
  const names = ['Ням', 'Даваа', 'Мягмар', 'Лхагва', 'Пүрэв', 'Баасан', 'Бямба'];
  const weekday = names[new Date(`${day}T00:00:00Z`).getUTCDay()];
  return `${day} · ${weekday}${label ? ` (${label})` : ''}`;
}

/* every way a service can be written */
function serviceIndex(services) {
  const entries = [];
  for (const service of services || []) {
    const names = new Set([service.name, ...(SERVICE_ALIASES[service.slug] || [])].map(key));
    for (const alias of names) if (alias) entries.push({ alias, service });
  }
  return entries;
}

/* Longest run of words first, so "oxy pro" wins over "oxy" and "x cryo"
   is never read as "cryo". */
function matchService(tokens, services) {
  const index = serviceIndex(services);
  for (let size = Math.min(4, tokens.length); size >= 1; size--) {
    for (let start = 0; start + size <= tokens.length; start++) {
      const joined = key(tokens.slice(start, start + size).join(''));
      if (!joined) continue;
      const hit = index.find(({ alias }) => SERVICE_SUFFIXES.some((suffix) => joined === alias + suffix));
      if (hit) return { service: hit.service, start, size };
    }
  }
  return null;
}

function matchCustomers(name, phone, customers) {
  const list = customers || [];
  const digits = String(phone || '');
  /* a number names one person — never fall back to a namesake with a different number */
  if (digits) return list.filter((c) => String(c.phone || '').replace(/\D/g, '').endsWith(digits));
  if (!name) return [];
  const wanted = key(name);
  const hits = list.filter((c) => matchesName(c.full_name, name));
  const exact = hits.filter((c) => key(c.full_name) === wanted);
  if (exact.length) return exact;
  /* «Болдод», «Болдын», «Сарааг» — the name with a case ending on it. Only an
     exact match on the stem counts, so an ending is never guessed off a real name. */
  for (const ending of NAME_ENDINGS) {
    if (!wanted.endsWith(ending) || wanted.length - ending.length < 2) continue;
    const stem = wanted.slice(0, -ending.length);
    const byStem = list.filter((c) => key(c.full_name) === stem);
    if (byStem.length) return byStem;
  }
  return hits;
}

/**
 * Read one line of text.
 * ctx: { services, customers, today }  — today as YYYY-MM-DD in Ulaanbaatar.
 * Returns what was understood; fields that were not mentioned are null.
 */
export function parseCommand(text, ctx = {}) {
  const today = ctx.today || todayInUlaanbaatar();
  const out = { intent: null, explicit: false, date: null, time: null, service: null, name: '', phone: null, customers: [], problems: [] };
  let rest = ` ${String(text || '').normalize('NFKC')} `;
  /* cut a piece out of the line once it has been understood */
  const take = (regex, handler) => {
    rest = rest.replace(regex, (...match) => (handler(...match) === false ? match[0] : ' '));
  };
  const noSuchDate = (m) => { out.problems.push(`«${m.trim()}» гэсэн огноо байхгүй.`); };

  if (/^\s*\?+\s*$/.test(rest)) { out.intent = 'help'; out.explicit = true; return out; }

  /* a full date first, so its year is never mistaken for half a phone number */
  take(/(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/, (m, y, mo, d) => {
    const day = validDay(+y, +mo, +d);
    if (day) out.date = day; else noSuchDate(m);
  });

  /* phone — eight digits, optionally written 9911 2233 or 9911-2233 */
  take(/(?<!\d)(\d{4})[\s-]?(\d{4})(?!\d)/, (m, a, b) => { out.phone = a + b; });

  /* dates with a month */
  take(/(?<!\d)(\d{1,2})\s*-?\s*р?\s*(?:сарын|sariin)\s*(\d{1,2})(?:\s*-?\s*(?:нд|ны|ний|д))?(?![\d:а-яөү])/i, (m, mo, d) => {
    const day = nextMonthDay(+mo, +d, today);
    if (day) out.date = day; else noSuchDate(m);
  });
  take(/(?<!\d)(\d{1,2})\/(\d{1,2})(?![\d/])/, (m, mo, d) => {
    if (out.date) return false;
    const day = nextMonthDay(+mo, +d, today);
    if (day) out.date = day; else noSuchDate(m);
  });

  /* times */
  take(/(?<!\d)(\d{1,2}):(\d{2})(?!\d)/, (m, h, mi) => { out.time = clock(h, mi); });
  take(/(?<!\d)(\d{1,2})\s*(?:цаг|tsag)\s*(\d{1,2})\s*(?:минут|мин|minut|min)?(?![\d:а-яөүa-z-])/i, (m, h, mi) => { if (out.time) return false; out.time = clock(h, mi); });
  take(/(?<!\d)(\d{1,2})\s*(?:хагас|hagas)[а-яөүa-z]*/i, (m, h) => { if (out.time) return false; out.time = clock(h, 30); });
  take(/(?<!\d)(\d{1,2})\s*(?:цаг|tsag)[а-яөүa-z]*/i, (m, h) => { if (out.time) return false; out.time = clock(h, 0); });
  /* "14.30" is a time, "11.25" is the 25th of November */
  take(/(?<!\d)(\d{1,2})\.(\d{2})(?!\d)/, (m, a, b) => {
    const asTime = !out.time && (b === '00' || b === '30') && +a >= 1 && +a <= CLOSE_HOUR;
    if (asTime) { out.time = clock(a, b); return true; }
    if (out.date) return false;
    const day = nextMonthDay(+a, +b, today);
    if (!day) return false;
    out.date = day;
    return true;
  });
  /* "25-нд", "25нд", "25-ны" — a day of this month, or of next month once it has passed */
  take(/(?<!\d)(\d{1,2})\s*-?\s*(?:нд|ны|ний|nd|nii)(?![а-яөүa-z])/i, (m, d) => {
    if (out.date) return false;
    const day = nextDayOfMonth(+d, today);
    if (!day) return false;
    out.date = day;
    return true;
  });

  /* what is left is words */
  let tokens = rest.split(/[\s,;!?()«»"“”]+/).filter(Boolean);

  /* Relative days and weekdays. Every weekday is also a common given name
     (Даваа, Баасан, Пүрэв…), so a weekday counts only when "гараг" follows. */
  tokens = tokens.filter((token, i) => {
    if (out.date) return true;
    const k = key(token);
    if (k.startsWith('onood') || k.startsWith('unuud') || k === TODAY) { out.date = today; return false; }
    if (k.startsWith('margaash') || k.startsWith('margash') || k === TOMORROW) { out.date = shiftDay(today, 1); return false; }
    if (k.startsWith('nogood') || k.startsWith('nuguud')) { out.date = shiftDay(today, 2); return false; }
    if (k.startsWith('ochigd') || k.startsWith('uchigd')) { out.date = shiftDay(today, -1); return false; }
    if (k in WEEKDAYS && key(tokens[i + 1] || '').startsWith(GARAG)) {
      const now = new Date(`${today}T00:00:00Z`).getUTCDay();
      out.date = shiftDay(today, (WEEKDAYS[k] - now + 7) % 7);
      return false;
    }
    return true;
  });

  /* what the employee wants done */
  tokens = tokens.filter((token) => {
    const k = key(token);
    const at = INTENTS.findIndex(([, rule]) => rule.exact.includes(k) || rule.starts.some((prefix) => k.startsWith(prefix)));
    if (at < 0) return true;
    const current = INTENTS.findIndex(([name]) => name === out.intent);
    if (current < 0 || at < current) out.intent = INTENTS[at][0];
    out.explicit = true;
    return false;
  });

  /* the service, by its own name or by shorthand */
  const found = matchService(tokens, ctx.services);
  if (found) {
    out.service = found.service;
    tokens.splice(found.start, found.size);
  }

  /* whatever survives is the name */
  out.name = tokens.filter((token) => !FILLER.has(key(token)) && /[a-zа-яөүё]/i.test(token)).join(' ').trim();
  out.customers = matchCustomers(out.name, out.phone, ctx.customers);

  if (out.time) {
    const [h, m] = out.time.split(':').map(Number);
    if (h < OPEN_HOUR || h >= CLOSE_HOUR) out.problems.push(`Төв ${pad(OPEN_HOUR)}:00–${CLOSE_HOUR}:00 цагт ажиллана. «${out.time}» боломжгүй.`);
    else if (m !== 0 && m !== 30) out.problems.push(`Цаг 30 минутын зайтай: ${pad(h)}:00 эсвэл ${pad(h)}:30 гэж бичнэ үү.`);
  }

  /* "захиалга" with a day or a device but nobody named is a request to see the bookings */
  if (out.intent === 'book' && !out.time && !out.name && !out.phone) out.intent = 'schedule';
  /* work out the intent when it was not said in so many words */
  if (!out.intent) {
    if (out.service && (out.time || out.name || out.phone)) out.intent = 'book';
    else if (out.time && (out.name || out.phone)) out.intent = 'book';
    else if (out.name || out.phone) out.intent = 'find';
    else if (out.date || out.service) out.intent = 'schedule';
    else out.intent = 'unknown';
  }
  return out;
}

/* Free start times for a service on a day, worked out the way the booking grid does.
   bookings: rows already narrowed to this service's calendar and not cancelled. */
export function freeTimes({ day, duration, bookings, blockedMinutes, now = Date.now(), includePast = false }) {
  const block = blockedMinutes(duration);
  const step = Math.max(30, block);
  const times = [];
  for (let minute = OPEN_HOUR * 60; minute + (Number(duration) || 30) <= CLOSE_HOUR * 60; minute += step) {
    const time = `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
    const start = Date.parse(`${day}T${time}:00+08:00`), end = start + block * 60000;
    if (!includePast && start < now) continue;
    const taken = bookings.some((row) => start < Date.parse(row.blocked_until || row.ends_at) && end > Date.parse(row.starts_at));
    if (!taken) times.push(time);
  }
  return times;
}

export const HELP_LINES = [
  'Цаг захиалах: «Болд маргааш 14:00 cryo cabin»',
  'Шинэ үйлчлүүлэгч: «Сараа 99112233 өнөөдөр 16:30 led»',
  'Хуваарь: «өнөөдрийн хуваарь», «маргаашийн захиалгууд»',
  'Сул цаг: «маргааш oxy сул цаг»',
  'Хайх: «Болд хайх» эсвэл утасны дугаар',
  'Багц: «Болд багц»',
];
