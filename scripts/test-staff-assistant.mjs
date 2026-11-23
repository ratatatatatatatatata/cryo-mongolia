// The staff assistant's reader, on the kinds of lines staff actually type.
// Pure functions only — no browser, no database.
import assert from 'node:assert/strict';
import { parseCommand, freeTimes, describeDay } from '../staff-assistant.js';

const services = [
  { id: 1, slug: 'cryocabin', name: 'Cryo°Cabin™', duration_minutes: 3 },
  { id: 2, slug: 'xcryo', name: 'X°Cryo™', duration_minutes: 10 },
  { id: 3, slug: 'ledpro', name: 'LedPro™', duration_minutes: 15 },
  { id: 4, slug: 'oxypro', name: 'OxyPro™', duration_minutes: 60 },
  { id: 5, slug: 'zerobody', name: 'Zerobody', duration_minutes: 35 },
  { id: 6, slug: 'normatec', name: 'Normatec', duration_minutes: 30 },
  { id: 7, slug: 'oxygen', name: 'Oxygen', duration_minutes: 30 },
  { id: 8, slug: 'massage', name: 'Бүтэн биеийн массаж', duration_minutes: 90 },
];
const customers = [
  { id: 1, full_name: 'Болд', phone: '99112233' },
  { id: 2, full_name: 'Болдбаатар', phone: '88001122' },
  { id: 3, full_name: 'Сараа', phone: '95556677' },
  { id: 4, full_name: 'Даваа', phone: '91110000' },
  { id: 5, full_name: 'Баасан', phone: '90001111' },
  { id: 6, full_name: 'Нямаа', phone: '80001111' },
];
// Tuesday 24 November 2026
const ctx = { services, customers, today: '2026-11-24' };
const read = (text) => parseCommand(text, ctx);
const slug = (r) => r.service?.slug || null;

// ── the headline case, in Cyrillic and in Latin ──
let r = read('Болд маргааш 14:00 cryo cabin');
assert.deepEqual([r.intent, r.date, r.time, slug(r), r.name], ['book', '2026-11-25', '14:00', 'cryocabin', 'Болд']);
assert.deepEqual(r.customers.map((c) => c.id), [1], 'an exact name beats a longer one that contains it');

r = read('bold margaash 14:00 cc');
assert.deepEqual([r.intent, r.date, r.time, slug(r)], ['book', '2026-11-25', '14:00', 'cryocabin']);
assert.deepEqual(r.customers.map((c) => c.id), [1], 'Latin spelling finds the Cyrillic name');

// ── word order is free, and case endings on the device do not matter ──
r = read('маргааш 2 цагт крио кабинд Сарааг биш Сараа');
assert.equal(r.time, '14:00', '"2 цагт" means the afternoon');
assert.equal(slug(r), 'cryocabin');
r = read('cryo cabin deer Сараа unuudur 16.30');
assert.deepEqual([r.date, r.time, slug(r), r.name], ['2026-11-24', '16:30', 'cryocabin', 'Сараа']);

// ── services: the longer name wins, shorthand works ──
assert.equal(slug(read('Болд x cryo 15:00')), 'xcryo', '"x cryo" is not Cryo Cabin');
assert.equal(slug(read('Болд oxy pro 15:00')), 'oxypro');
assert.equal(slug(read('Болд oxy 15:00')), 'oxypro');
assert.equal(slug(read('Болд rl 15:00')), 'ledpro');
assert.equal(slug(read('Болд улаан гэрэл 15:00')), 'ledpro');
assert.equal(slug(read('Болд zb 15:00')), 'zerobody');
assert.equal(slug(read('Болд nor 15:00')), 'normatec');
assert.equal(slug(read('Болд хүчилтөрөгч 15:00')), 'oxygen');
r = read('Болд бүтэн биеийн массаж 15:00');
assert.equal(slug(r), 'massage', 'a service is found by its own name too');
assert.equal(r.name, 'Болд', 'and its words do not leak into the name');

// ── times ──
assert.equal(read('Болд cc 9:30').time, '09:30');
assert.equal(read('Болд cc 2 хагаст').time, '14:30');
assert.equal(read('Болд cc 14 цаг 30').time, '14:30');
assert.equal(read('Болд cc 10 цагт').time, '10:00');
assert.equal(read('Болд cc 14tsagt').time, '14:00');
assert.ok(read('Болд cc 22:00').problems.length, 'outside opening hours is refused');
assert.ok(read('Болд cc 14:20').problems.length, 'off the half-hour grid is refused');
assert.equal(read('Болд cc 14:30').problems.length, 0);

// ── dates ──
assert.equal(read('Болд cc 14:00 нөгөөдөр').date, '2026-11-26');
assert.equal(read('Болд cc 14:00 11/27').date, '2026-11-27');
assert.equal(read('Болд cc 14:00 11.27').date, '2026-11-27', '"11.27" is a date');
assert.equal(read('Болд cc 11.30').time, '11:30', '"11.30" is a time');
assert.equal(read('Болд cc 14:00 2026-12-01').date, '2026-12-01');
assert.equal(read('Болд cc 14:00 27-нд').date, '2026-11-27');
assert.equal(read('Болд cc 14:00 3-нд').date, '2026-12-03', 'a day already past rolls to next month');
assert.equal(read('Болд cc 14:00 12 сарын 5').date, '2026-12-05');
assert.equal(read('Болд cc 14:00 12-р сарын 5-нд').date, '2026-12-05');
assert.equal(read('Болд cc 14:00 1/5').date, '2027-01-05', 'a month already past rolls to next year');
assert.ok(read('Болд cc 14:00 2/30').problems.length, 'a date that does not exist is named, not guessed');
assert.equal(read('Болд cc 14:00').date, null, 'no date said stays unsaid');

// ── weekdays are also names: only "гараг" makes one a day ──
r = read('Баасан маргааш 14:00 cc');
assert.deepEqual([r.name, r.date], ['Баасан', '2026-11-25'], 'Баасан the person, booked for tomorrow');
r = read('Даваа 14:00 cc');
assert.deepEqual([r.name, r.date], ['Даваа', null]);
r = read('Болд баасан гарагт 14:00 cc');
assert.deepEqual([r.name, r.date], ['Болд', '2026-11-27'], 'Friday of this week');
r = read('Болд мягмар гарагт 14:00 cc');
assert.equal(r.date, '2026-11-24', 'today is Tuesday, so Tuesday means today');
assert.equal(read('Нямаа 14:00 cc').name, 'Нямаа', 'a name that starts like a weekday stays a name');

// ── phone numbers ──
r = read('Тэмүүлэн 99887766 өнөөдөр 16:30 led');
assert.deepEqual([r.intent, r.name, r.phone, slug(r), r.time], ['book', 'Тэмүүлэн', '99887766', 'ledpro', '16:30']);
assert.equal(r.customers.length, 0, 'an unknown number is a new customer');
assert.equal(read('Тэмүүлэн 9988 7766 cc 14:00').phone, '99887766');
r = read('Болд 77778888 cc 14:00');
assert.equal(r.customers.length, 0, 'a different number is a different Болд, not the one on file');
r = read('99112233');
assert.deepEqual([r.intent, r.customers.map((c) => c.id)], ['find', [1]], 'a bare number looks the customer up');
assert.equal(read('2026-11-25 cc Болд 14:00').phone, null, 'a year is not half a phone number');

// ── a partial name offers a choice rather than picking ──
r = read('Бол маргааш 14:00 cc');
assert.deepEqual(r.customers.map((c) => c.id).sort(), [1, 2]);

assert.deepEqual(read('Бо маргааш 14:00 cc').customers.map((c) => c.id).sort(), [1, 2]);
assert.equal(read('Ба маргааш 14:00 cc').name, 'Ба', 'two letters of a name are a name, not the word "and"');

// ── the other requests ──
assert.equal(read('өнөөдрийн хуваарь').intent, 'schedule');
assert.equal(read('өнөөдрийн хуваарь').date, '2026-11-24');
r = read('маргаашийн захиалгууд');
assert.deepEqual([r.intent, r.date], ['schedule', '2026-11-25']);
r = read('маргаашийн захиалга');
assert.equal(r.intent, 'schedule', '"захиалга" with nobody named asks to see the bookings');
r = read('unuudriin huvaari cc');
assert.deepEqual([r.intent, slug(r)], ['schedule', 'cryocabin']);
r = read('маргааш oxy сул цаг');
assert.deepEqual([r.intent, r.date, slug(r), r.name], ['free', '2026-11-25', 'oxypro', '']);
r = read('Болд хайх');
assert.deepEqual([r.intent, r.name], ['find', 'Болд']);
assert.equal(read('Сараа').intent, 'find', 'a bare name looks the customer up');
r = read('Болд багц');
assert.deepEqual([r.intent, r.name], ['balance', 'Болд']);
assert.equal(read('Болдын багцын үлдэгдэл').intent, 'balance');
assert.equal(read('тусламж').intent, 'help');
assert.equal(read('?').intent, 'help');
assert.equal(read('   ').intent, 'unknown');
r = read('Болдод маргааш 14:00 cryo cabin дээр цаг захиал');
assert.deepEqual([r.intent, r.date, r.time, slug(r)], ['book', '2026-11-25', '14:00', 'cryocabin']);
assert.deepEqual(r.customers.map((c) => c.id), [1], '«Болдод» is Болд with a case ending');
assert.deepEqual(read('Болдын багцын үлдэгдэл').customers.map((c) => c.id), [1]);
assert.deepEqual(read('Сарааг маргааш 14:00 cc').customers.map((c) => c.id), [3]);
assert.deepEqual(read('Болдбаатарт 14:00 cc').customers.map((c) => c.id), [2], 'the ending comes off the longer name too');
assert.equal(read('Сараа нэр дээр led бүртгэ 15:00').name, 'Сараа');

// ── everything else a staff member does ──
const staff = [{ id: 7, name: 'Чимгээ' }, { id: 8, name: 'Denis' }];
const readS = (text) => parseCommand(text, { ...ctx, staff });
const pays = (r) => r.payments.map((p) => `${p.method}:${p.amount}`).join(' ');

// payment: one method, split, amount before or after the method, with separators and thousands
r = read('Болд төлбөр хаан');
assert.deepEqual([r.intent, r.name, pays(r)], ['pay', 'Болд', 'khan:null']);
assert.equal(pays(read('Болд төлбөр хаан 100000 бэлэн 49000')), 'khan:100000 cash:49000');
assert.equal(pays(read('Болд төлбөр 149000 голомт')), 'golomt:149000', 'the amount may come first');
assert.equal(pays(read('Болд төлбөр хаан 149,000')), 'khan:149000');
assert.equal(pays(read('Болд төлбөр бэлнээр 149к')), 'cash:149000');
assert.equal(pays(read('Болд tulbur khan 1.5 сая')), 'khan:1500000');
assert.equal(pays(read('Болд төлбөр дотоод')), 'internal:null');
r = read('Болд төлбөр gift');
assert.deepEqual([r.intent, pays(r)], ['pay', 'gift_card:null'], 'on a payment line "gift" is the method');
assert.equal(read('Болд төллөө нэхэмжлэхээр').payments[0].method, 'invoice');

// changing a booking
r = read('Болд 14:00 цуцал');
assert.deepEqual([r.intent, r.name, r.time], ['cancel', 'Болд', '14:00']);
assert.equal(read('Болдын захиалгыг цуцал').intent, 'cancel', 'a cancellation, not a booking');
assert.deepEqual(read('Болдын захиалгыг цуцал').customers.map((c) => c.id), [1]);
r = read('Болд 14:00 устга');
assert.deepEqual([r.intent, r.name], ['delete', 'Болд']);
r = read('Болд 14:00-г 15:30 болго');
assert.deepEqual([r.intent, r.name, r.times], ['move', 'Болд', ['14:00', '15:30']], 'the ending on a time is not part of the name');
r = read('Болдын цагийг маргааш 15:00 руу зөө');
assert.deepEqual([r.intent, r.date, r.times, r.customers.map((c) => c.id)], ['move', '2026-11-25', ['15:00'], [1]]);
r = read('Болд cc-г led болго');
assert.deepEqual([r.intent, r.services.map((s) => s.slug)], ['move', ['cryocabin', 'ledpro']]);
r = read('Болд cc-г бүтэн биеийн массаж болго');
assert.deepEqual(r.services.map((s) => s.slug), ['cryocabin', 'massage'], 'services stay in the order typed, however long their names');
r = read('Болд ирсэн');
assert.deepEqual([r.intent, r.name], ['done', 'Болд']);
assert.equal(read('Болд 14:00 баталгаажуул').intent, 'confirm');
r = readS('Болд cc Чимгээ хийсэн');
assert.deepEqual([r.intent, r.name, slug(r), r.staff?.id], ['provider', 'Болд', 'cryocabin', 7], 'the staff name is not the customer');
r = read('Болд маргааш 14:00 cc багцаар');
assert.deepEqual([r.intent, r.byPackage, slug(r)], ['book', true, 'cryocabin']);

// the employee's own shift — only when said alone
assert.equal(read('ирлээ').intent, 'clockin');
assert.equal(read('ажил эхэллээ').intent, 'clockin');
assert.equal(read('явлаа').intent, 'clockout');
assert.equal(read('гарлаа').intent, 'clockout');
assert.equal(read('Болд ирлээ').intent, 'done', 'with a name it is the customer who arrived');

// extra income
r = read('нэмэлт орлого balloon Бат 45000 бэлэн');
assert.deepEqual([r.intent, r.incomeKind, r.name, pays(r), r.service], ['income', 'oxygen_balloon', 'Бат', 'cash:45000', null]);
r = read('нэмэлт орлого oxygen balloon Клуб 90000 хаан');
assert.deepEqual([r.incomeKind, r.name, r.service], ['oxygen_balloon', 'Клуб', null], '"oxygen balloon" is income, not a session');
assert.equal(read('нэмэлт орлого нэхэмжлэл МТ ХХК 500000 нэхэмжлэх').incomeKind, 'invoice');

// gift cards
r = read('gift card Тэмүүлэн 99887766 олго 200000 хаан');
assert.deepEqual([r.intent, r.sub, r.name, r.phone, pays(r)], ['gift', 'sell', 'Тэмүүлэн', '99887766', 'khan:200000']);
r = read('gift card Болд хас 149000 cc');
assert.deepEqual([r.intent, r.sub, r.name, r.amounts, slug(r)], ['gift', 'use', 'Болд', [149000], 'cryocabin']);
assert.deepEqual([read('gift card Болд').intent, read('gift card Болд').sub], ['gift', 'balance']);
assert.equal(read('гифт карт Болд').intent, 'gift');

// packages
r = read('Болд багц зар Recovery хаан 500000');
assert.deepEqual([r.intent, r.sub, r.name, pays(r)], ['package', 'sell', 'Болд Recovery', 'khan:500000'], 'the package name is left for the caller to find');
r = read('Болд багц оролт cc led');
assert.deepEqual([r.intent, r.sub, r.name, r.services.map((s) => s.slug)], ['package', 'use', 'Болд', ['cryocabin', 'ledpro']]);
assert.equal(read('Болд багц').intent, 'balance');

// teams
r = read('баг Аварга Бат cc led');
assert.deepEqual([r.intent, r.sub, r.name, r.services.length], ['team', 'visit', 'Аварга Бат', 2]);
r = read('баг Аварга гишүүн нэм Тэмүүлэн');
assert.deepEqual([r.intent, r.sub, r.name], ['team', 'member', 'Аварга Тэмүүлэн']);

// the rest
r = read('шинэ үйлчлүүлэгч Тэмүүлэн 99887766');
assert.deepEqual([r.intent, r.name, r.phone], ['customer', 'Тэмүүлэн', '99887766']);
assert.equal(read('өнөөдрийн борлуулалт').intent, 'sales');
r = read('захиалга хуудас нээ');
assert.deepEqual([r.intent, r.target], ['open', 'захиалга']);
assert.equal(read('багц руу оч').target, 'багц');
assert.equal(read('Хаанаа 99112200').intent, 'find', 'a name is not a payment method');

// ── free times follow the booking grid ──
const block = (d) => Math.max(30, Math.ceil((Number(d) || 30) / 30) * 30);
const at = (t) => `2026-11-25T${t}:00+08:00`;
let free = freeTimes({ day: '2026-11-25', duration: 3, blockedMinutes: block, now: 0, bookings: [
  { starts_at: at('10:00'), ends_at: at('10:03'), blocked_until: at('10:30') },
] });
assert.equal(free.length, 23, '24 half-hours from 09:00 to 20:30, one taken');
assert.ok(!free.includes('10:00') && free.includes('10:30') && free.at(-1) === '20:30');
free = freeTimes({ day: '2026-11-25', duration: 60, blockedMinutes: block, now: 0, bookings: [] });
assert.deepEqual([free[0], free[1], free.at(-1)], ['09:00', '10:00', '20:00'], 'an hour-long service steps by the hour');
free = freeTimes({ day: '2026-11-25', duration: 3, blockedMinutes: block, now: Date.parse(at('15:10')), bookings: [] });
assert.equal(free[0], '15:30', 'times already gone are left out');

assert.equal(describeDay('2026-11-25', '2026-11-24'), '2026-11-25 · Лхагва (маргааш)');
console.log('PASS staff assistant: booking lines in both scripts, services, times, dates, weekday names, phones, the other requests, free times');
