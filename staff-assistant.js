/* ══════════════════════════════════════════════════════════════
   Staff assistant — the part that reads what was typed.

   No AI and no network: a command such as
       «Болд маргааш 14:00 cryo cabin»   or   «Болд төлбөр хаан»
   is taken apart piece by piece — phone, dates, times, money, the
   request word, services — and whatever is left is the name. Nothing
   here touches the database; admin.js decides what to do with the
   result and asks the employee to confirm before anything is written.

   Kept free of DOM and Supabase so it can be tested in plain Node.
   ══════════════════════════════════════════════════════════════ */
import { nameKey, matchesName } from './name-search.js';

const OPEN_HOUR = 9, CLOSE_HOUR = 21;
/* one spelling for Cyrillic and Latin: «крио кабин», "krio kabin" and "Cryo°Cabin™" all meet here */
const key = (value) => nameKey(value).replace(/[^a-z0-9]/g, '');
const pad = (n) => String(n).padStart(2, '0');
const keys = (...words) => words.map(key);

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
const SERVICE_SUFFIXES = ['', 'd', 't', 'nd', 'ruu', 'deer', 'aar', 'eer', 'g', 'ig', 'iig', 'aas', 'ees', 'iin'];

/* How each request is recognised: a word that starts with one of `starts`,
   or is exactly one of `exact`. When a line holds several, the earlier row
   wins — «Болдын захиалгыг цуцал» is a cancellation, not a booking. */
const INTENTS = [
  ['help', ['тусламж', 'туслаач'], ['help', 'заавар']],
  ['pay', ['төлб', 'tulb', 'төлс', 'tuls', 'төлл', 'tull', 'төлн', 'tuln'], ['төл', 'tul', 'тооцоо']],
  ['income', [], ['нэмэлт', 'balloon', 'баллон', 'бөмбөлөг', 'нэхэмжлэл', 'nehemjlel']],
  ['gift', [], ['gift', 'гифт', 'giftcard', 'гифткарт', 'карт', 'card', 'kart']],
  ['team', [], ['баг', 'багт', 'багийн', 'багийг', 'team']],
  ['package', ['багц'], []],
  ['cancel', ['цуцал', 'цуцл'], []],
  ['delete', ['устг'], []],
  ['move', ['зөө', 'zuu', 'шилжүүл', 'хойшлуул', 'урагшлуул'], ['болго', 'соль', 'солих', 'өөрчил', 'uurchil']],
  ['provider', [], ['хийсэн', 'хийлээ', 'үзүүлсэн', 'гүйцэтгэсэн']],
  ['done', [], ['биелсэн', 'дууссан', 'үйлчлүүлсэн', 'ирсэн', 'ирлээ', 'irsen', 'irlee']],
  ['confirm', ['баталгааж'], []],
  ['sales', ['борлуулалт'], ['тайлан']],
  ['schedule', ['хуваар', 'huvaar', 'захиалгууд', 'жагсаалт'], []],
  ['free', ['чөлөөт'], ['сул', 'завтай']],
  ['balance', ['үлдэгд'], ['үлдсэн']],
  ['find', [], ['хай', 'хайх', 'хайж', 'хайя', 'хайгаад', 'хайгаач', 'find', 'search']],
  ['book', ['захиал', 'бүртг'], []],
].map(([name, starts, exact]) => ({ name, starts: keys(...starts), exact: keys(...exact) }));
const RANK = Object.fromEntries(INTENTS.map((rule, i) => [rule.name, i]));

/* what to do within a gift card, a package or a team */
const SUBS = [
  /* «борлуулалт» is the sales report, so the verb is listed form by form rather than by its stem */
  ['sell', ['худалд', 'олго'], ['зар', 'зарах', 'зарлаа', 'зарсан', 'зарна', 'заръя', 'борлуул', 'борлуулах', 'борлууллаа', 'борлуулна', 'борлуулъя']],
  /* «орж байна», «орлоо», «оръё» — the customer is going in on their package */
  ['use', ['ашигл', 'оруул'], ['хас', 'хасах', 'хаслаа', 'хасна', 'хасъя', 'оролт', 'орлоо', 'орж', 'орсон', 'орно', 'оръё', 'орох', 'ороод', 'оров', 'орчихлоо', 'орчлоо']],
  ['member', ['гишүүн', 'gishuun'], []],
  ['add', [], ['нэм', 'нэмэх', 'нэмлээ', 'нэмнэ', 'нэмье']],
].map(([name, starts, exact]) => ({ name, starts: keys(...starts), exact: keys(...exact) }));

/* how the money came in — the columns of the sales ledger */
const METHODS = Object.fromEntries([
  ['khan', ['хаан', 'хаанаар', 'khan']],
  ['golomt', ['голомт', 'голомтоор', 'golomt']],
  ['cash', ['бэлэн', 'бэлнээр', 'belneer', 'cash']],
  ['invoice', ['нэхэмжлэх', 'нэхэмжлэхээр', 'nehemjleh', 'invoice']],
  ['barter', ['бартер', 'бартераар', 'barter']],
  ['internal', ['дотоод', 'internal']],
].flatMap(([method, words]) => keys(...words).map((word) => [word, method])));
export const METHOD_LABEL = { khan: 'Хаан', golomt: 'Голомт', cash: 'Бэлэн', invoice: 'Нэхэмжлэх', barter: 'Barter', internal: 'Дотоод', gift_card: 'Gift card' };

/* said alone, these are about the employee's own shift */
const CLOCK_IN = new Set(keys('ирлээ', 'ирсэн', 'ирц', 'ажилдаа ирлээ', 'ажил эхэллээ', 'ажил эхлэх', 'ажил эхэлье', 'ирсэн цаг', 'ирц бүртгэ', 'ирсэн цаг бүртгэ', 'ирцээ бүртгэ'));
const CLOCK_OUT = new Set(keys('явлаа', 'гарлаа', 'тарлаа', 'ажил дууслаа', 'ажил дуусгах', 'ажил тарлаа', 'гарсан цаг', 'явсан цаг', 'гарсан цаг бүртгэ', 'явлаа баяртай'));
const OPEN_WORDS = new Set(keys('нээ', 'нээх', 'нээгээч', 'нээнэ', 'нээе', 'open', 'оч', 'очих'));
const PAGE_FILLER = new Set(keys('хуудас', 'хуудсыг', 'цэс', 'цэсийг', 'хэсэг', 'хэсгийг', 'руу', 'рүү', 'ruu'));

/* Words that carry no information once the pieces above are taken out.
   «ба» is deliberately not here: typed alone it is far more often the start
   of a name (Бат, Баяр, Батболд) than the word "and". */
const FILLER = new Set(keys('дээр', 'der', 'д', 'т', 'нэрээр', 'нэр', 'гэж', 'гэдэг', 'цаг', 'цагт', 'цагийн', 'цагийг',
  'өдөр', 'өдөрт', 'udur', 'udurt', 'гараг', 'гарагт', 'харуул', 'харуулаач', 'үз', 'үзүүл',
  'байна', 'bn', 'уу', 'юу', 'вэ', 'бэ', 'ямар', 'хэд', 'хэдэн', 'нь', 'өгөөч', 'uguuch', 'өг',
  'ав', 'авъя', 'авах', 'авлаа', 'авсан', 'хийж', 'хий', 'хийгээд', 'хийгээч', 'шалга', 'шалгаач', 'хүн', 'хүнийг',
  'үйлчлүүлэгч', 'үйлчлүүлэгчийн', 'төхөөрөмж', 'tuhuurumj', 'шинэ', 'орлого', 'орлогод', 'мөнгө',
  'захиалгыг', 'захиалгаа', 'руу', 'рүү', 'ruu', 'болон', 'өнөөдрийн', 'эрхээр', 'рт', 'аас', 'ээс', 'хаанаас',
  'одоо', 'яг', 'энэ', 'тэр', 'удаа', 'удаагаа', 'дахиад', 'дахин', 'байгаа', 'бна', 'baina', 'л', 'ээ'));

/* ── questions about what has been going on ──
   «өнөөдөр хэдэн үйлчлүүлэгч үйлчлүүлсэн бэ», «энэ сарын орлого хэд вэ».
   A line is a question when it holds a question word and one of these
   topics; the first topic that fits wins, so the narrower ones come first.
   Words are written both ways a Latin typist spells ө/ү. */
const QUESTION_STARTS = keys('хэд', 'хичнээн', 'hicheen', 'hichneen');
const QUESTION_EXACT = new Set(keys('хэн', 'хэнд', 'хэний', 'хэзээ', 'аль', 'вэ', 'бэ', 'уу', 'үү', 'юу', 'ямар', 've', 'be', 'uu', 'yu', 'yamar', 'hezee', 'hen'));
const TOPICS = [
  ['history', ['сүүлд', 'suuld', 'хэзээ', 'hezee', 'түүх', 'tuuh']],
  ['working', ['ажиллаж', 'ajillaj']],
  ['staff', ['ажилтан', 'ажилчид', 'ajiltan', 'ajilchid']],
  ['pending', ['ирээгүй', 'ireegui', 'хүлээгд', 'huleegd']],
  ['unpaid', ['төлөөгүй', 'tuluugui', 'tuluugvi', 'төлбөргүй', 'tulburgui', 'төлөгдөөгүй']],
  ['next', ['дараагийн', 'дараачийн', 'daraagiin', 'daraachiin']],
  ['cancelled', ['цуцлагд', 'цуцалсан', 'tsutslagd', 'tsutsalsan']],
  ['newcustomers', [], ['шинэ', 'shine', 'шинээр', 'shineer']], // whole word only: «Шинэбаяр» is a person
  ['packages', ['багц', 'bagts']],
  ['devices', ['төхөөрөмж', 'tuhuurumj', 'tuhuuromj', 'аппарат', 'apparat']],
  ['income', ['орлого', 'orlogo', 'борлуулалт', 'borluulalt', 'мөнгө', 'mungu', 'mongo', 'төгрөг', 'tugrug', 'tugrig', 'ашиг']],
  ['bookings', ['захиалга', 'zahialga']],
  ['served', ['үйлчлүүл', 'uilchluul', 'ирсэн', 'irsen', 'орсон', 'orson', 'үйлчилсэн', 'uilchilsen'], ['хүн', 'hun', 'хүмүүс']],
].map(([name, starts, exact = []]) => ({ name, starts: keys(...starts), exact: keys(...exact) }));
const topicHit = (rule, k) => rule.exact.includes(k) || rule.starts.some((prefix) => k.startsWith(prefix));
/* words that belong to the question, not to anybody's name */
const ASK_FILLER = new Set(keys('хамгийн', 'hamgiin', 'их', 'ih', 'бага', 'сүүлийн', 'suuliin', 'нийт', 'niit', 'хоног', 'honog', 'удаа', 'udaa',
  'зарагдсан', 'zaragdsan', 'идэвхтэй', 'idevhtei', 'буй', 'bui', 'боллоо', 'болсон', 'болж', 'гарсан', 'хийсэн', 'hiisen', 'ирсэн', 'irsen',
  'орсон', 'orson', 'ирлээ', 'байсан', 'baisan', 'өдөр', 'долоо', 'doloo', 'сар', 'sar', 'сард', 'сарын', 'онд', 'жил', 'хэр', 'her', 'вэ', 'бэ', 'уу', 'үү'));

/* «нэгээр орж байна» — how many sessions, when it is said */
const COUNTS = Object.fromEntries([
  [1, ['нэг', 'нэгээр', 'нэгийг', 'ганц', 'ганцаар']], [2, ['хоёр', 'хоёроор', 'хоёрыг']], [3, ['гурав', 'гурваар', 'гурвыг']],
  [4, ['дөрөв', 'дөрвөөр']], [5, ['тав', 'таваар']],
].flatMap(([n, words]) => keys(...words).map((word) => [word, n])));

const WEEKDAYS = Object.fromEntries(
  [['ням', 0], ['даваа', 1], ['мягмар', 2], ['лхагва', 3], ['пүрэв', 4], ['баасан', 5], ['бямба', 6]]
    .map(([name, day]) => [key(name), day]));
/* case endings a name picks up in a sentence, longest first */
const NAME_ENDINGS = keys('ийнх', 'ийг', 'ийн', 'тай', 'тэй', 'той', 'аас', 'ээс', 'оос', 'өөс', 'од', 'ад', 'эд', 'өд', 'ын', 'ыг', 'д', 'т', 'г', 'н')
  .filter((ending, i, all) => ending && all.indexOf(ending) === i).sort((a, b) => b.length - a.length);
const GARAG = key('гараг');
const TODAY = key('today'), TOMORROW = key('tomorrow');
const BY_PACKAGE = new Set(keys('багцаар', 'багцын эрхээр', 'bagtsaar'));

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
function matchService(tokens, index) {
  for (let size = Math.min(4, tokens.length); size >= 1; size--) {
    for (let start = 0; start + size <= tokens.length; start++) {
      const run = tokens.slice(start, start + size);
      /* a word already taken by another service leaves a gap; never read across it */
      if (run.some((token) => !token)) continue;
      const joined = key(run.join(''));
      if (!joined) continue;
      const hit = index.find(({ alias }) => SERVICE_SUFFIXES.some((suffix) => joined === alias + suffix));
      if (hit) return { service: hit.service, start, size };
    }
  }
  return null;
}

/**
 * Find one of `items` named somewhere in a run of words — a staff member, a
 * team, a package. Only a whole name counts (with or without a case ending),
 * so «Бат» never picks «Батболд». Returns the item and the words left over.
 */
export function findNamed(words, items, nameOf = (item) => item.name) {
  const tokens = Array.isArray(words) ? words : String(words || '').split(/\s+/).filter(Boolean);
  const index = (items || []).map((item) => ({ item, k: key(nameOf(item)) })).filter((entry) => entry.k);
  for (let size = Math.min(4, tokens.length); size >= 1; size--) {
    for (let start = 0; start + size <= tokens.length; start++) {
      const joined = key(tokens.slice(start, start + size).join(''));
      if (!joined) continue;
      const hit = index.find(({ k }) => joined === k || NAME_ENDINGS.some((ending) => joined === k + ending));
      if (hit) return { item: hit.item, rest: [...tokens.slice(0, start), ...tokens.slice(start + size)] };
    }
  }
  return { item: null, rest: tokens };
}

/* Customers a name or a phone number points at. Exported because some
   lines hold two names — «Болд багц зар Recovery» — and the caller has to
   take the package name out before it can look the customer up. */
export function findCustomers(name, phone, customers) {
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

/* the same person's name, allowing for a case ending: «Болд» and «Болдод» */
export function sameName(a, b) {
  const x = key(a), y = key(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return NAME_ENDINGS.some((ending) => long === short + ending);
}

/* how many single-letter slips apart two spellings are */
function editDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length];
}

/**
 * Names that look like a slip of the one typed — «Болт» for «Болд»,
 * "Saraa" for «Сара». Cyrillic and Latin are compared in one spelling, so a
 * name typed in the other script still finds its match. A short name may be
 * one letter off, a longer one two or three; nearest first.
 */
export function similarNames(name, names, limit = 5) {
  const wanted = key(name);
  if (wanted.length < 2) return [];
  const seen = new Set([wanted]);
  const scored = [];
  for (const candidate of names || []) {
    const k = key(candidate);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const longest = Math.max(wanted.length, k.length);
    const allowed = longest <= 5 ? 1 : longest <= 10 ? 2 : 3;
    const d = editDistance(wanted, k);
    /* the start of a name typed short, or a longer form of it */
    const partial = wanted.length >= 3 && (k.startsWith(wanted) || wanted.startsWith(k));
    /* A slip keeps the first letter. Without that, two letters apart would
       pair up different names that merely rhyme — Ганболд and Батболд. */
    const slip = d <= allowed && (d <= 1 || wanted[0] === k[0]);
    if (slip || partial) scored.push({ candidate, score: partial ? Math.min(d, 1.5) : d });
  }
  return scored.sort((a, b) => a.score - b.score || a.candidate.length - b.candidate.length).slice(0, limit).map((entry) => entry.candidate);
}

/* the customers behind similarNames, one per person */
export function similarCustomers(name, customers, limit = 5) {
  const list = customers || [];
  const names = similarNames(name, list.map((c) => c.full_name), limit * 2);
  const out = [];
  for (const candidate of names) for (const c of list) if (c.full_name === candidate && out.length < limit) out.push(c);
  return out;
}

const ruleHit = (rules, k) => rules.find((rule) => rule.exact.includes(k) || rule.starts.some((prefix) => k.startsWith(prefix)));

/**
 * Read one line of text.
 * ctx: { services, customers, staff, today }  — today as YYYY-MM-DD in Ulaanbaatar.
 * Returns what was understood; fields that were not mentioned are null or empty.
 */
export function parseCommand(text, ctx = {}) {
  const today = ctx.today || todayInUlaanbaatar();
  const out = {
    intent: null, sub: null, explicit: false,
    date: null, time: null, dates: [], times: [],
    service: null, services: [], name: '', phone: null, customers: [], staff: null,
    payments: [], amounts: [], incomeKind: null, byPackage: false, count: null, target: '', problems: [],
    topic: null, range: null,
  };
  const line = String(text || '').normalize('NFKC');
  let rest = ` ${line} `;
  /* cut each piece out of the line once it has been understood */
  const take = (regex, handler) => {
    for (let i = 0; i < 4; i++) {
      const before = rest;
      rest = rest.replace(regex, (...match) => (handler(...match) === false ? match[0] : ' '));
      if (rest === before) break;
    }
  };
  const addDate = (day) => { out.dates.push(day); };
  const addTime = (time) => { if (time) out.times.push(time); };
  const noSuchDate = (m) => { out.problems.push(`«${m.trim()}» гэсэн огноо байхгүй.`); };
  /* «14:00-г», «11/27-нд», «15:30руу» — the ending belongs to the number, not to the name */
  const END = String.raw`(?:\s*-\s*[а-яөү]{1,6}|[а-яөү]{1,4})?(?![а-яөү])`;
  const withEnding = (source) => new RegExp(source + END, 'i');

  if (/^\s*\?+\s*$/.test(rest)) { out.intent = 'help'; out.explicit = true; return out; }

  /* the employee's own shift, said with nothing else */
  const whole = key(line);
  if (CLOCK_IN.has(whole) || CLOCK_OUT.has(whole)) {
    out.intent = CLOCK_IN.has(whole) ? 'clockin' : 'clockout';
    out.explicit = true;
    return out;
  }

  /* «захиалга хуудас нээ» — go to a page; the rest of the line names it */
  {
    const words = line.split(/[\s,;!?()«»"“”]+/).filter(Boolean);
    if (words.some((word) => OPEN_WORDS.has(key(word)))) {
      out.intent = 'open';
      out.explicit = true;
      out.target = words.filter((word) => !OPEN_WORDS.has(key(word)) && !PAGE_FILLER.has(key(word))).join(' ');
      return out;
    }
  }

  /* «шинэ үйлчлүүлэгч Сараа 99112233» */
  let addCustomer = false;
  take(/(?:шинэ|shine)\s+(?:үйлчлүүлэгч|uilchluulegch)[а-яөүa-z]*|(?:үйлчлүүлэгч|uilchluulegch)[а-яөүa-z]*\s+(?:нэм|бүртг|nem|burtg)[а-яөүa-z]*/i, () => { addCustomer = true; });

  /* money written with separators or in thousands: 149,000 · 149к · 1.5 сая */
  rest = rest.replace(/(\d)[,'’](?=\d{3}(?!\d))/g, '$1');
  rest = rest.replace(/(?<![\d.:/])(\d+(?:[.,]\d+)?)\s*(сая|saya|мянга|мян|myanga|к|k)(?![а-яөүa-z])/gi, (m, n, unit) => {
    const scale = /^(сая|saya)$/i.test(unit) ? 1e6 : 1e3;
    return ` ${Math.round(Number(n.replace(',', '.')) * scale)} `;
  });

  /* a full date first, so its year is never mistaken for half a phone number */
  take(withEnding(String.raw`(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)`), (m, y, mo, d) => {
    const day = validDay(+y, +mo, +d);
    if (day) addDate(day); else noSuchDate(m);
  });

  /* phone — eight digits, optionally written 9911 2233 or 9911-2233 */
  take(/(?<!\d)(\d{4})[\s-]?(\d{4})(?!\d)/, (m, a, b) => { if (out.phone) return false; out.phone = a + b; return true; });

  /* dates with a month */
  take(/(?<!\d)(\d{1,2})\s*-?\s*р?\s*(?:сарын|sariin)\s*(\d{1,2})(?:\s*-?\s*(?:нд|ны|ний|д))?(?![\d:а-яөү])/i, (m, mo, d) => {
    const day = nextMonthDay(+mo, +d, today);
    if (day) addDate(day); else noSuchDate(m);
  });
  take(withEnding(String.raw`(?<!\d)(\d{1,2})\/(\d{1,2})(?![\d/])`), (m, mo, d) => {
    const day = nextMonthDay(+mo, +d, today);
    if (day) addDate(day); else noSuchDate(m);
  });

  /* times — a line can hold two: «14:00-г 15:30 болго» */
  take(withEnding(String.raw`(?<!\d)(\d{1,2}):(\d{2})(?!\d)`), (m, h, mi) => { addTime(clock(h, mi)); });
  take(/(?<!\d)(\d{1,2})\s*(?:цаг|tsag)\s*(\d{1,2})\s*(?:минут|мин|minut|min)?(?![\d:а-яөүa-z-])/i, (m, h, mi) => { addTime(clock(h, mi)); });
  take(/(?<!\d)(\d{1,2})\s*(?:хагас|hagas)[а-яөүa-z]*/i, (m, h) => { addTime(clock(h, 30)); });
  take(/(?<!\d)(\d{1,2})\s*(?:цаг|tsag)[а-яөүa-z]*/i, (m, h) => { addTime(clock(h, 0)); });
  /* "14.30" is a time, "11.25" is the 25th of November */
  take(withEnding(String.raw`(?<!\d)(\d{1,2})\.(\d{2})(?!\d)`), (m, a, b) => {
    if ((b === '00' || b === '30') && +a >= 1 && +a <= CLOSE_HOUR) { addTime(clock(a, b)); return true; }
    const day = nextMonthDay(+a, +b, today);
    if (!day) return false;
    addDate(day);
    return true;
  });
  /* "25-нд", "25нд", "25-ны" — a day of this month, or of next month once it has passed */
  take(/(?<!\d)(\d{1,2})\s*-?\s*(?:нд|ны|ний|nd|nii)(?![а-яөүa-z])/i, (m, d) => {
    const day = nextDayOfMonth(+d, today);
    if (!day) return false;
    addDate(day);
    return true;
  });

  /* a stretch of days, for questions: this week, last month, the last 7 days */
  const asked = /\?\s*$/.test(line);
  {
    const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
    const monday = shiftDay(today, -weekday);
    const monthStart = (y, m) => `${y}-${pad(m)}-01`;
    const monthEnd = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
    const last = /(?:өнгөрсөн|өмнөх|ungursun|ongorson|umnuh|omnoh)/.source, week = /(?:долоо\s*хоног|7\s*хоног|doloo\s*honog|7\s*honog)[а-яөүa-z]*/.source, month = /(?:сар|sar)(?:ын|д|ийн|iin|d)?(?![а-яөүa-z])/.source;
    /* first, so that «сүүлийн 7 хоног» is seven days back and not "this week" */
    take(/(?:сүүлийн|suuliin)\s+(\d{1,3})\s*(?:хоног|өдөр|honog|udur|odor)[а-яөүa-z]*/i, (mm, n) => { out.range = { from: shiftDay(today, -(Number(n) - 1)), to: today, label: `сүүлийн ${Number(n)} хоног` }; });
    take(new RegExp(`${last}\\s+${week}`, 'i'), () => { if (out.range) return false; out.range = { from: shiftDay(monday, -7), to: shiftDay(monday, -1), label: 'өнгөрсөн долоо хоног' }; return true; });
    take(new RegExp(`(?:(?:энэ|ene)\\s+)?${week}`, 'i'), () => { if (out.range) return false; out.range = { from: monday, to: shiftDay(monday, 6), label: 'энэ долоо хоног' }; return true; });
    take(new RegExp(`${last}\\s+${month}`, 'i'), () => { if (out.range) return false; const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y; out.range = { from: monthStart(py, pm), to: monthEnd(py, pm), label: 'өнгөрсөн сар' }; return true; });
    take(new RegExp(`(?:энэ|ene)\\s+${month}`, 'i'), () => { if (out.range) return false; out.range = { from: monthStart(y, m), to: monthEnd(y, m), label: 'энэ сар' }; return true; });
  }

  /* what is left is words */
  let tokens = rest.split(/[\s,;!?()«»"“”]+/).filter(Boolean);

  /* Relative days and weekdays. Every weekday is also a common given name
     (Даваа, Баасан, Пүрэв…), so a weekday counts only when "гараг" follows. */
  tokens = tokens.filter((token, i) => {
    const k = key(token);
    if (k.startsWith('onood') || k.startsWith('unuud') || k === TODAY) { addDate(today); return false; }
    if (k.startsWith('margaash') || k.startsWith('margash') || k === TOMORROW) { addDate(shiftDay(today, 1)); return false; }
    if (k.startsWith('nogood') || k.startsWith('nuguud')) { addDate(shiftDay(today, 2)); return false; }
    if (k.startsWith('ochigd') || k.startsWith('uchigd')) { addDate(shiftDay(today, -1)); return false; }
    if (k in WEEKDAYS && key(tokens[i + 1] || '').startsWith(GARAG)) {
      const now = new Date(`${today}T00:00:00Z`).getUTCDay();
      addDate(shiftDay(today, (WEEKDAYS[k] - now + 7) % 7));
      return false;
    }
    return true;
  });
  out.date = out.dates[0] || null;
  out.time = out.times[0] || null;

  /* Is this a question about what has been going on? Decided here, on the
     words as typed, before the request words below are taken out of them. */
  let topic = null;
  {
    const ks = tokens.map(key);
    /* a line carrying a phone number is somebody's details being entered, not a question */
    const question = asked || (!out.phone && ks.some((k) => QUESTION_EXACT.has(k) || QUESTION_STARTS.some((prefix) => k.startsWith(prefix))));
    if (question) {
      /* «Болд хэдэн удаа ирсэн бэ» counts one person's visits, not the day's customers */
      if (ks.some((k) => k.startsWith(key('удаа')))) topic = TOPICS[0];
      else if (addCustomer) topic = TOPICS.find((rule) => rule.name === 'newcustomers');
      else topic = TOPICS.find((rule) => ks.some((k) => topicHit(rule, k))) || null;
    }
  }

  /* One pass in the order typed, so «хаан 100000 бэлэн 49000» pairs each
     amount with the method beside it. */
  const found = new Set();
  let giftWord = false, looseAmount = null;
  tokens = tokens.filter((token, at, all) => {
    const k = key(token);
    if (/^\d{4,8}$/.test(token)) {
      const amount = Number(token);
      const open = out.payments.find((payment) => payment.amount == null);
      if (open) open.amount = amount;
      else if (looseAmount == null) looseAmount = amount;
      else out.amounts.push(amount);
      return false;
    }
    if (BY_PACKAGE.has(k)) { out.byPackage = true; return false; }
    if (k in COUNTS) { out.count = COUNTS[k]; return false; }
    /* «2 удаа» */
    if (/^\d$/.test(token) && Number(token) > 0 && key(all[at + 1] || '').startsWith(key('удаа'))) { out.count = Number(token); return false; }
    if (k in METHODS) {
      out.payments.push({ method: METHODS[k], amount: looseAmount });
      looseAmount = null;
      return false;
    }
    const sub = ruleHit(SUBS, k);
    if (sub) { if (!out.sub || sub.name === 'member') out.sub = sub.name; return false; }
    const intent = ruleHit(INTENTS, k);
    if (intent) {
      found.add(intent.name);
      if (intent.name === 'gift') giftWord = true;
      if (intent.name === 'income') {
        if (['balloon', 'ballon'].includes(k) || k === key('баллон') || k === key('бөмбөлөг')) out.incomeKind = 'oxygen_balloon';
        if (k === key('нэхэмжлэл') || k === 'nehemjlel') out.incomeKind = 'invoice';
      }
      return false;
    }
    return true;
  });
  if (looseAmount != null) out.amounts.unshift(looseAmount);
  if (addCustomer) found.add('customer');

  /* the request: the highest-ranked word found */
  if (found.has('customer')) out.intent = 'customer';
  else out.intent = [...found].sort((a, b) => RANK[a] - RANK[b])[0] || null;
  out.explicit = !!out.intent;
  /* «Болд төлбөр gift» pays with a gift card; anywhere else the word names the gift-card desk */
  if (out.intent === 'pay' && giftWord) out.payments.push({ method: 'gift_card', amount: out.amounts.shift() ?? null });
  /* «Болд орлоо», «одоо нэгээр орж байна» — going in, with no desk named, is a package visit */
  if (!out.intent && out.sub === 'use') { out.intent = 'package'; out.explicit = true; }

  /* services, by their own name or by shorthand — a package visit can name several.
     An extra-income line is about money, and «oxygen balloon» there is not a session. */
  if (out.intent !== 'income') {
    /* Kept in the order typed: «cabin-г led болго» means from the cabin to the LED,
       whichever of the two names happens to be the longer match. */
    const index = serviceIndex(ctx.services);
    const hits = [];
    for (let i = 0; i < 6; i++) {
      const hit = matchService(tokens, index);
      if (!hit) break;
      hits.push(hit);
      for (let at = hit.start; at < hit.start + hit.size; at++) tokens[at] = '';
    }
    hits.sort((a, b) => a.start - b.start).forEach((hit) => { if (!out.services.includes(hit.service)) out.services.push(hit.service); });
    tokens = tokens.filter(Boolean);
  } else if (tokens.some((token) => key(token) === key('oxygen'))) {
    out.incomeKind = out.incomeKind || 'oxygen_balloon';
    tokens = tokens.filter((token) => key(token) !== key('oxygen'));
  }
  out.service = out.services[0] || null;

  /* who did the session: «Болд cc Чимгээ хийсэн» */
  if (out.intent === 'provider') {
    const named = findNamed(tokens, ctx.staff);
    out.staff = named.item;
    tokens = named.rest;
  }

  /* whatever survives is the name */
  out.name = tokens.filter((token) => !FILLER.has(key(token)) && /[a-zа-яөүё]/i.test(token)).join(' ').trim();
  out.customers = findCustomers(out.name, out.phone, ctx.customers);

  for (const time of out.times) {
    const [h, m] = time.split(':').map(Number);
    if (h < OPEN_HOUR || h >= CLOSE_HOUR) out.problems.push(`Төв ${pad(OPEN_HOUR)}:00–${CLOSE_HOUR}:00 цагт ажиллана. «${time}» боломжгүй.`);
    else if (m !== 0 && m !== 30) out.problems.push(`Цаг 30 минутын зайтай: ${pad(h)}:00 эсвэл ${pad(h)}:30 гэж бичнэ үү.`);
  }

  /* a question is answered, never acted on — whatever request words it happens to contain */
  if (topic) {
    out.intent = 'ask';
    out.topic = topic.name;
    out.explicit = true;
    out.sub = null;
    out.name = tokens.filter((token) => {
      const k = key(token);
      return !FILLER.has(k) && !ASK_FILLER.has(k) && !QUESTION_EXACT.has(k) && !QUESTION_STARTS.some((prefix) => k.startsWith(prefix)) && !topicHit(topic, k) && /[a-zа-яөүё]/i.test(token);
    }).join(' ').trim();
    out.customers = findCustomers(out.name, out.phone, ctx.customers);
    return out;
  }

  /* a package with no verb is a look at the balance; «…багцаар» on a booking line is a booking */
  if (out.intent === 'package' && !out.sub) {
    if (out.time && out.service) { out.intent = 'book'; out.byPackage = true; } else out.intent = 'balance';
  }
  if (out.intent === 'package' && out.sub === 'add') out.sub = 'sell';
  if (out.intent === 'gift' && !out.sub) out.sub = 'balance';
  if (out.intent === 'team' && !out.sub) out.sub = 'visit';
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

export const HELP_GROUPS = [
  ['Захиалга', [
    '«Болд маргааш 14:00 cryo cabin» — цаг захиалах',
    '«Болд cc» — яг одоо ирсэн бол: одоогийн цагт бүртгэнэ',
    '«Сараа 99112233 өнөөдөр 16:30 led» — утастай нь бичвэл үйлчлүүлэгчээр хадгална',
    '«Болд 14:00-г 15:30 болго» — цаг зөөх',
    '«Болд 14:00 цуцал» · «Болд 14:00 устга»',
    '«Болд ирсэн» — биелсэн гэж тэмдэглэх',
    '«Болд cc Чимгээ хийсэн» — үйлчилгээ үзүүлсэн ажилтан',
  ]],
  ['Төлбөр, орлого', [
    '«Болд төлбөр хаан» — захиалгын төлбөр',
    '«Болд төлбөр хаан 100000 бэлэн 49000» — хувааж төлөх',
    '«Болд төлбөр дотоод» · «Болд төлбөр gift»',
    '«нэмэлт орлого balloon Бат 45000 бэлэн»',
  ]],
  ['Багц, gift card, баг', [
    '«Болд багц» — үлдэгдэл · дараа нь «одоо нэгээр орж байна»',
    '«Болд орлоо» · «Болд багц оролт cc led» — багцын оролт',
    '«Болд багц зар Recovery хаан 500000»',
    '«gift card Болд 99112233 олго 200000 хаан»',
    '«gift card Болд хас 149000» · «gift card Болд»',
    '«баг Аварга Бат cc» — багийн гишүүний оролт',
  ]],
  ['Асуулт', [
    '«өнөөдөр хэдэн үйлчлүүлэгч үйлчлүүлсэн бэ»',
    '«энэ долоо хоногийн орлого хэд вэ» · «маргааш хэдэн захиалга байна»',
    '«хэн төлөөгүй байна» · «хэн ажиллаж байна» · «дараагийн захиалга хэн бэ»',
    '«Болд сүүлд хэзээ ирсэн бэ» · «аль төхөөрөмж хамгийн их вэ»',
  ]],
  ['Бусад', [
    '«ирлээ» · «явлаа» — өөрийн ирц',
    '«өнөөдрийн хуваарь» · «маргааш oxy сул цаг»',
    '«өнөөдрийн борлуулалт» · «Болд хайх»',
    '«шинэ үйлчлүүлэгч Сараа 99112233»',
    '«захиалга хуудас нээ» — хуудас руу очих',
  ]],
];
/* kept for callers that want a flat list */
export const HELP_LINES = HELP_GROUPS.flatMap(([, lines]) => lines);
