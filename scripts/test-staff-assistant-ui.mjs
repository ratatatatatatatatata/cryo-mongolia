// The staff assistant in the real admin page, against a mock database (no live writes).
// Every action a staff member can take is driven from a typed line and checked
// down to the exact table or RPC call it makes.
// Run: node scripts/test-staff-assistant-ui.mjs   (needs playwright)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const types = { html: 'text/html', js: 'application/javascript', css: 'text/css', svg: 'image/svg+xml' };
const ubDay = (offset = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar' }).format(new Date(Date.now() + offset * 86400000));
const today = ubDay(0), tomorrow = ubDay(1), nextWeek = ubDay(7);

const dataFor = (role, paid) => ({
  profiles: [{ id: 'u1', email: 'me@test.mn', full_name: 'Тест', role }],
  services: [
    { id: 1, slug: 'cryocabin', name: 'Cabin', category: 'cryo', duration_minutes: 3, price: 149000, active: true, sort: 1 },
    { id: 9, slug: 'facial', name: 'Гоо сайхан', category: 'beauty', duration_minutes: 60, price: 150000, active: true, sort: 9 },
    { id: 7, slug: 'oxygen', name: 'Oxygen', category: 'oxygen', duration_minutes: 30, price: 35000, active: true, sort: 7 },
  ],
  staff: [{ id: 7, name: 'Чимгээ', active: true, sort: 1, user_id: 'u1' }, { id: 8, name: 'Denis', active: true, sort: 2 }],
  customers: [
    { id: 1, full_name: 'Бат', phone: '99112233', is_vip: true },
    { id: 2, full_name: 'Батболд', phone: '88001122' },
    { id: 3, full_name: 'Сараа', phone: '95556677' },
    { id: 4, full_name: 'Нарантуяа эгч', phone: '70001234' },
  ],
  bookings: [{ id: 1, ref: 'B1', customer_name: 'Сараа', phone: '95556677', service_id: 1, calendar_id: 1, service: 'Cabin', booked_date: today, booked_time: '10:00', starts_at: today + 'T10:00:00+08:00', blocked_until: today + 'T10:30:00+08:00', status: 'confirmed', payment_status: paid ? 'paid' : 'pending', booking_kind: 'standard' }],
  sales: [], attendance: [],
  packages: [{ id: 3, slug: 'recovery', name: 'Recovery', price: 500000, old_price: 600000, active: true, service_units: [] }],
  customer_package_contracts: [
    // an older, imported package: it lists no services, only its name says what it is for
    { id: 60, customer_id: 4, customer_label: 'Нарантуяа эгч', package_label: 'Эгчийн Oxygen багц', total_units: 4, status: 'active', service_units: [] },
    // a newer one that says exactly what it covers; the cabin sessions are used up
    { id: 61, customer_id: 2, customer_label: 'Батболд', package_label: 'Хосолсон', total_units: 3, status: 'active', service_units: [{ service_id: 1, service_name: 'Cabin', units: 2 }, { service_id: 9, service_name: 'Гоо сайхан', units: 1 }] },
  ],
  package_redemptions: [
    { id: 1, contract_id: 60, used_on: '2026-11-01', units: 1, service_id: 7, service_label: 'Oxygen' },
    { id: 2, contract_id: 61, used_on: '2026-11-02', units: 2, service_id: 1, service_label: 'Cabin' },
  ],
  gift_cards: [{ id: 4, code: 'GC-1', recipient_name: 'Бат', recipient_phone: '99112233', amount: 300000 }],
  gift_card_uses: [{ id: 1, card_id: 4, amount: 100000 }],
  // what the 2026 sheet import brings in: the shift plan, and package visits from the visit ledger
  staff_schedule: [
    { id: 1, staff_id: 7, staff_name: 'Чимгээ', work_date: today, shift_start: null, shift_end: null },
    { id: 2, staff_id: 8, staff_name: 'Denis', work_date: today, shift_start: '09:00:00', shift_end: '15:00:00' },
    { id: 3, staff_id: 8, staff_name: 'Denis', work_date: tomorrow, shift_start: null, shift_end: null },
  ],
  service_sessions: [
    { id: 1, session_date: today, customer_label: 'Золбоо', service_id: 1, service_label: 'Cryo Cabin', notes: 'Багцаар · Pack' },
    { id: 2, session_date: today, customer_label: 'Нарантуяа эгч', service_id: 7, service_label: 'Oxygen', notes: 'Багцаар · Pack' },
  ],
  sports_teams: [{ id: 5, name: 'Аварга', service_prices: { 1: 25000 } }],
  sports_team_members: [{ id: 9, team_id: 5, full_name: 'Дорж' }],
});

/* A stand-in for Supabase that keeps tables in memory, records every write
   and answers each RPC with the shape the real function returns. */
const mockClient = (role, paid) => `
  const data=${JSON.stringify(dataFor(role, paid))};const session={user:{id:'u1',email:'me@test.mn'}};
  window.inserted=[];window.rpcs=[];window.updates=[];let nextId=100;
  const blocked=(row)=>new Date(Date.parse(row.starts_at)+Math.max(30,Math.ceil(((data.services.find(s=>s.id===row.service_id)||{}).duration_minutes||30)/30)*30)*60000).toISOString();
  const answers={
    is_admin:()=>${role !== 'staff'},
    set_booking_status:(a)=>{const b=data.bookings.find(x=>x.id===a.p_booking_id);b.status=a.p_status;return{booking:{...b}}},
    delete_booking:(a)=>{data.bookings=data.bookings.filter(x=>x.id!==a.p_booking_id);return{}},
    edit_booking:(a)=>{const b=data.bookings.find(x=>x.id===a.p_booking_id);Object.assign(b,a.p_patch);b.booked_date=b.starts_at.slice(0,10);b.booked_time=b.starts_at.slice(11,16);b.blocked_until=blocked(b);return{...b}},
    record_booking_provider:(a)=>{const b=data.bookings.find(x=>x.id===a.p_booking_id);b.performed_by=a.p_staff_id;return{...b}},
    pay_bookings:(a)=>{const rows=data.bookings.filter(x=>a.p_booking_ids.includes(x.id));rows.forEach(b=>b.payment_status='paid');const sale={id:nextId++,sale_date:'${today}',total:0,source:'manual',...a.p_sale};sale.total=['golomt','khan','cash','invoice','barter'].reduce((n,k)=>n+(sale[k]||0),0);data.sales.push(sale);return{bookings:rows.map(b=>({...b})),sales:[sale]}},
    add_extra_income:(a)=>({sale:{id:nextId++,sale_date:'${today}',services:'Oxygen balloon',customer_name:a.p.source,total:a.p.amount,[a.p.payment_method]:a.p.amount,source:'manual'}}),
    start_employee_attendance:(a)=>{const row={id:nextId++,staff_id:a.p_staff_id,work_date:new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0')+'-'+String(new Date().getDate()).padStart(2,'0'),clock_in:new Date().toISOString(),clock_out:null};data.attendance.push(row);return row},
    issue_gift_card:(a)=>({card:{id:nextId++,code:'GC-NEW',recipient_name:a.p.recipient_name,amount:a.p.amount},sale:null}),
    use_gift_card:(a)=>({use:{id:nextId++,card_id:a.p.card_id,amount:a.p.amount},sale:null}),
    package_checkout:(a)=>({sale:null,contract:{id:50,customer_id:a.p.customer_id,customer_label:data.customers.find(c=>c.id===a.p.customer_id).full_name,package_id:a.p.package_id,package_label:'Recovery',total_units:10,status:'active',purchased_on:a.p.sale_date}}),
    record_sports_member_visit:()=>1,
    add_sports_member:()=>({}),
  };
  export const createClient=()=>({auth:{getSession:async()=>({data:{session}}),getUser:async()=>({data:{user:session.user}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}},signOut:async()=>({})},
   rpc:async(name,args)=>{window.rpcs.push({name,args});const answer=answers[name];return{data:answer?answer(args||{}):[],error:null}},
   from(table){let single=false,written=null,patch=null,filters=[];const q={select(){return q},order(){return q},is(){return q},neq(){return q},gte(){return q},lte(){return q},in(){return q},not(){return q},range(){return q},limit(){return q},maybeSingle(){single=true;return q},single(){single=true;return q},
     eq(column,value){filters.push([column,value]);return q},
     insert(value){written=(Array.isArray(value)?value:[value]).map(row=>({id:nextId++,...(row.starts_at?{booked_date:String(row.starts_at).slice(0,10),booked_time:String(row.starts_at).slice(11,16),blocked_until:blocked(row),payment_status:'pending'}:{}),...row}));written.forEach(row=>window.inserted.push({table,...row}));(data[table]=data[table]||[]).push(...written);return q},
     update(value){patch=value;return q},
     then(r){let rows=written||data[table]||[];if(patch){rows=rows.filter(row=>filters.every(([c,v])=>row[c]===v));rows.forEach(row=>Object.assign(row,patch));window.updates.push({table,patch,ids:rows.map(row=>row.id)});}r({data:single?(rows[0]||null):rows,error:null})}};return q},
   channel(){const c={on(){return c},subscribe(){return c}};return c},removeChannel(){}});`;

async function open(browser, role, { paid = false } = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: types.js, body: mockClient(role, paid) });
    if (url.hostname !== 'test.local') return route.abort();
    const path = url.pathname === '/' ? '/admin.html' : url.pathname;
    if (path === '/supabase-config.js') return route.fulfill({ contentType: types.js, body: `window.CRYO_SUPABASE={url:'https://test.local',anonKey:'k'};` });
    try { return route.fulfill({ contentType: types[path.split('.').pop()] || 'text/plain', body: await readFile(new URL('..' + path, import.meta.url)) }); }
    catch { return route.fulfill({ status: 404, body: '' }); }
  });
  await page.goto('https://test.local/');
  await page.locator('#asstOpen').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#asstOpen').click();
  const say = async (text) => { await page.locator('#asstInput').fill(text); await page.locator('#asstInput').press('Enter'); await page.waitForTimeout(250); };
  const last = () => page.locator('#asstLog .asst-msg.bot').last();
  const reply = () => last().innerText();
  const press = async (label) => { await last().locator('button', { hasText: label }).first().click(); await page.waitForTimeout(300); };
  const rpc = async (name) => (await page.evaluate(() => window.rpcs)).filter((call) => call.name === name).at(-1)?.args;
  const count = (expr) => page.evaluate(expr);
  return { page, errors, say, last, reply, press, rpc, count };
}

const browser = await chromium.launch({ headless: true });
try {
  /* ══ an admin: any day is allowed ══ */
  const a = await open(browser, 'admin');
  assert.match(await a.reply(), /Болд маргааш 14:00 cryo cabin/, 'opens with what it can do');

  /* ── booking ── */
  await a.say('Бат маргааш 14:00 cabin');
  let text = await a.reply();
  assert.match(text, /Ингэж бүртгэх үү/);
  assert.match(text, /Бат · 99112233/, 'the exact name wins over «Батболд»');
  assert.match(text, new RegExp(tomorrow));
  assert.equal(await a.count(() => window.inserted.length), 0, 'nothing is written before the employee confirms');
  await a.press('Бүртгэх');
  let inserted = await a.count(() => window.inserted);
  assert.deepEqual(
    [inserted[0].table, inserted[0].customer_name, inserted[0].phone, inserted[0].service_id, inserted[0].starts_at, inserted[0].status, inserted[0].staff_id, inserted[0].booking_kind],
    ['bookings', 'Бат', '99112233', 1, `${tomorrow}T14:00:00+08:00`, 'confirmed', 7, 'standard']);
  assert.match(await a.reply(), /Бүртгэлээ: Бат · Cabin/);

  await a.say(`Батболд ${tomorrow} 14:00 cabin`);
  assert.match(await a.reply(), /завгүй байна/, 'its own booking blocks the slot straight away');
  await a.press('14:30');
  assert.match(await a.reply(), /Батболд · 88001122/);
  await a.press('Бүртгэх');
  assert.equal((await a.count(() => window.inserted)).filter((row) => row.table === 'bookings').length, 2);

  await a.say('Ба маргааш 15:00 cabin');
  assert.match(await a.reply(), /3 үйлчлүүлэгч байна|2 үйлчлүүлэгч байна/, 'a partial name asks which one');
  await a.press('Болих');

  // a name that is not on file is booked as typed — no phone is demanded, only the confirmation
  await a.say('Тэмүүлэн маргааш cabin 16:30');
  text = await a.reply();
  assert.match(text, /Ингэж бүртгэх үү/, 'it goes straight to the confirmation');
  assert.match(text, /Тэмүүлэн · утасгүй/);
  await a.press('Бүртгэх');
  inserted = await a.count(() => window.inserted);
  assert.deepEqual([inserted.at(-1).customer_name, inserted.at(-1).phone], ['Тэмүүлэн', null]);
  assert.ok(!inserted.some((row) => row.table === 'customers'), 'a customer record needs a phone, so none is made');
  // with a phone on the line the new customer is saved too
  await a.say('Ганболд 99887766 маргааш cabin 17:00');
  assert.match(await a.reply(), /Ганболд · 99887766[\s\S]*Шинэ үйлчлүүлэгчээр|Шинэ үйлчлүүлэгчээр[\s\S]*Ганболд · 99887766/);
  await a.press('Бүртгэх');
  inserted = await a.count(() => window.inserted);
  assert.ok(inserted.some((row) => row.table === 'customers' && row.full_name === 'Ганболд' && row.phone === '99887766'), 'the new customer is saved');

  /* ── a mistyped name, or a number that belongs to someone else ── */
  // the number is on file under another name: say whose it is
  await a.say('Бат 88001122 маргааш 18:00 cabin');
  text = await a.reply();
  assert.match(text, /88001122 дугаар дээр «Батболд» бүртгэлтэй байна\. Нэрийг буруу бичсэн үү/);
  assert.equal(await a.last().locator('button', { hasText: '«Бат» нэрээр бүртгэх' }).count(), 1, 'the name as typed stays on offer — people share phones');
  await a.press('Батболд · 88001122');
  assert.match(await a.reply(), /Ингэж бүртгэх үү[\s\S]*Батболд · 88001122/);
  await a.press('Болих');
  // a slip of a name on file: offer the name it probably is
  await a.say('Сарая маргааш 18:00 cabin');
  text = await a.reply();
  assert.match(text, /«Сарая» жагсаалтад алга\. Эдгээрийн аль нэг мөн үү/);
  await a.press('Сараа · 95556677');
  assert.match(await a.reply(), /Ингэж бүртгэх үү[\s\S]*Сараа · 95556677/);
  await a.press('Болих');
  // …or keep it exactly as typed
  await a.say('Сарая маргааш 18:00 cabin');
  await a.press('«Сарая» нэрээр бүртгэх');
  assert.match(await a.reply(), /Ингэж бүртгэх үү[\s\S]*Сарая · утасгүй/);
  await a.press('Болих');
  // the same help when looking someone up, and when acting on a booking
  await a.say('Сарая хайх');
  text = await a.reply();
  assert.match(text, /олдсонгүй\. Ойролцоо нэрс/);
  assert.equal(await a.last().locator('button', { hasText: 'Сараа · 95556677' }).count(), 1);
  await a.say('Дорж 99112233');
  assert.match(await a.reply(), /99112233 дугаар дээр «Дорж» биш, ийм хүн бүртгэлтэй байна:[\s\S]*Бат · 99112233/);
  await a.say('Сарая цуцал');
  assert.match(await a.reply(), /тохирох захиалга олдсонгүй\. Эдгээрийн аль нэг мөн үү/);
  await a.press('Сараа');
  assert.match(await a.reply(), /Цуцлах үү[\s\S]*Сараа/);
  await a.press('Болих');
  await a.say('Сарая багц');
  assert.match(await a.reply(), /үйлчлүүлэгч олдсонгүй\. Эдгээрийн аль нэг мөн үү/);
  await a.say('болих');

  // a walk-in: just the name and the device — the time is now, and nothing is asked but the confirmation
  {
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ulaanbaatar', hour: '2-digit', hour12: false }).format(new Date()));
    await a.say('Батболд cabin');
    text = await a.reply();
    if (hour >= 9 && hour < 21) {
      assert.match(text, /Ингэж бүртгэх үү/, 'no question about the time during opening hours');
      assert.match(text, /одоогийн цагт авлаа|хамгийн ойрын сул цагт авлаа/);
      assert.match(text, new RegExp(today));
    } else assert.match(text, /Хэдэн цагт вэ/, 'outside opening hours there is no "now" to take');
    await a.press('Болих');
  }

  // earlier hours of today are offered and can be booked (a visit written up afterwards)
  await a.say('өнөөдөр cabin сул цаг');
  assert.match(await a.reply(), /09:00/, 'the morning is listed even once it has passed');
  await a.say('Батболд өнөөдөр 09:00 cabin');
  assert.match(await a.reply(), /Ингэж бүртгэх үү/);
  await a.press('Болих');

  // moving a booking that has no phone: the edit function insists on one, so that — and only that — is asked for
  await a.say('Тэмүүлэн 16:30-г 17:30 болго');
  assert.match(await a.reply(), /утас шаарддаг/);
  await a.say('99887700');
  assert.match(await a.reply(), new RegExp(`Шинэ ${tomorrow} 17:30 · Cabin · Тэмүүлэн`));
  await a.press('Өөрчлөх');
  assert.deepEqual([(await a.rpc('edit_booking')).p_patch.phone, (await a.rpc('edit_booking')).p_patch.starts_at], ['99887700', `${tomorrow}T17:30:00+08:00`]);

  await a.say('Бат маргааш 15:00 cabin багцаар');
  assert.match(await a.reply(), /Багцын эрхээр/);
  await a.press('Бүртгэх');
  assert.equal((await a.count(() => window.inserted)).at(-1).booking_kind, 'package');

  await a.say('Бат маргааш 14:30 гоо сайхан');
  assert.match(await a.reply(), /эхлэх боломжгүй/, 'an hour-long service keeps to its own grid');
  await a.say('болих');
  await a.say('Бат маргааш 22:00 cabin');
  assert.match(await a.reply(), /09:00–21:00/);
  await a.say('болих');

  /* ── moving a booking ── */
  await a.say('Батболд 14:30-г 16:00 болго');
  text = await a.reply();
  assert.match(text, /Ингэж өөрчлөх үү/);
  assert.match(text, new RegExp(`Шинэ ${tomorrow} 16:00 · Cabin · Батболд`));
  await a.press('Өөрчлөх');
  let call = await a.rpc('edit_booking');
  assert.deepEqual([call.p_patch.starts_at, call.p_patch.service_id, call.p_patch.customer_name, call.p_patch.phone], [`${tomorrow}T16:00:00+08:00`, 1, 'Батболд', '88001122']);
  // onto a slot someone else holds
  await a.say('Батболд 16:00-г 14:00 болго');
  assert.match(await a.reply(), /завгүй байна[\s\S]*Бат/, 'a move cannot land on a taken slot');
  await a.say('болих');
  // a change of device only
  await a.say('Батболд cabin-г гоо сайхан болго');
  assert.match(await a.reply(), /Шинэ .* 16:00 · Гоо сайхан/);
  await a.press('Болих');

  /* ── who performed it, status, delete ── */
  await a.say('Батболд cabin Denis хийсэн');
  assert.match(await a.reply(), /Ажилтан Denis/);
  await a.press('Бүртгэх');
  assert.deepEqual(await a.rpc('record_booking_provider'), { p_booking_id: (await a.rpc('edit_booking')).p_booking_id, p_staff_id: 8 });

  await a.say('Батболд цуцал');
  assert.match(await a.reply(), /Баталгаажсан → Цуцалсан/);
  await a.press('Цуцлах');
  call = await a.rpc('set_booking_status');
  assert.deepEqual([call.p_status, call.p_staff_id], ['cancelled', 7]);
  await a.say('Батболд цуцал');
  assert.match(await a.reply(), /тохирох захиалга олдсонгүй/, 'a cancelled booking is not offered again');

  await a.say('Тэмүүлэн устга');
  assert.match(await a.reply(), /бүрмөсөн устгах уу/);
  const before = await a.count(() => window.rpcs.filter((c) => c.name === 'delete_booking').length);
  await a.press('Болих');
  assert.equal(await a.count(() => window.rpcs.filter((c) => c.name === 'delete_booking').length), before, 'cancelling a delete deletes nothing');
  await a.say('Тэмүүлэн устга');
  await a.press('Устгах');
  assert.ok(await a.rpc('delete_booking'));
  assert.match(await a.reply(), /Устгалаа/);

  /* ── payment ── */
  await a.say('Сараа төлбөр');
  text = await a.reply();
  assert.match(text, /Нийт ₮149,000\. Яаж төлсөн бэ/);
  await a.say('болих');
  await a.say('Сараа төлбөр хаан 100000 бэлэн 40000');
  assert.match(await a.reply(), /₮9,000 дутуу/, 'a split that does not add up is refused');
  await a.say('Сараа төлбөр хаан 100000 бэлэн');
  text = await a.reply();
  assert.match(text, /Хаан ₮100,000 \+ Бэлэн ₮49,000/, 'the method left blank takes the remainder');
  assert.equal(await a.count(() => window.rpcs.filter((c) => c.name === 'pay_bookings').length), 0);
  await a.press('Төлсөн');
  call = await a.rpc('pay_bookings');
  assert.deepEqual(call.p_booking_ids, [1]);
  assert.deepEqual([call.p_sale.khan, call.p_sale.cash, call.p_sale.golomt, call.p_sale.cryo_cabin, call.p_sale.customer_name, call.p_sale.phone, call.p_sale.staff_id, call.p_sale.sale_date],
    [100000, 49000, 0, 1, 'Сараа', '95556677', 7, today]);
  assert.match(call.p_sale.services, /Cabin/);
  await a.say('Сараа төлбөр хаан');
  assert.match(await a.reply(), /төлөх захиалга үлдээгүй/, 'a paid booking cannot be paid twice');

  await a.say('Сараа ирсэн');
  await a.press('Биелсэн болгох');
  assert.equal((await a.rpc('set_booking_status')).p_status, 'done');

  /* ── extra income, asked for piece by piece ── */
  await a.say('нэмэлт орлого');
  assert.match(await a.reply(), /Ямар орлого вэ/);
  await a.press('Oxygen balloon');
  assert.match(await a.reply(), /Хаанаас орсон бэ/);
  await a.say('Клуб');
  assert.match(await a.reply(), /Хэдэн төгрөг вэ/);
  await a.say('45000');
  assert.match(await a.reply(), /төлбөрийн хэлбэр/);
  await a.press('Бэлэн');
  assert.match(await a.reply(), /Хаанаас Клуб[\s\S]*Дүн ₮45,000/);
  await a.press('Бүртгэх');
  call = await a.rpc('add_extra_income');
  assert.deepEqual([call.p.kind, call.p.source, call.p.amount, call.p.payment_method, call.p.staff_id], ['oxygen_balloon', 'Клуб', 45000, 'cash', 7]);

  /* ── the employee's own shift ── */
  await a.say('ирлээ');
  assert.match(await a.reply(), /Ирсэн цагийг одоо бүртгэх үү/);
  await a.press('Ирсэн');
  assert.deepEqual(await a.rpc('start_employee_attendance'), { p_staff_id: 7 });
  await a.say('ирлээ');
  assert.match(await a.reply(), /ирсэн гэж бүртгэгдсэн байна/, 'arriving twice is not recorded twice');
  await a.say('явлаа');
  await a.press('Гарсан');
  const out = (await a.count(() => window.updates)).at(-1);
  assert.equal(out.table, 'attendance');
  assert.ok(out.patch.clock_out && out.ids.length === 1);

  /* ── a new customer ── */
  await a.say('шинэ үйлчлүүлэгч Ганаа 91112222');
  await a.press('Бүртгэх');
  assert.ok((await a.count(() => window.inserted)).some((row) => row.table === 'customers' && row.full_name === 'Ганаа' && row.phone === '91112222'));
  await a.say('шинэ үйлчлүүлэгч Хэн нэгэн 99112233');
  assert.match(await a.reply(), /бүртгэлтэй байна: ★ VIP · Бат/, 'a number already on file is not registered again');

  /* ── gift cards ── */
  await a.say('gift card Бат');
  assert.match(await a.reply(), /GC-1 · Бат · ₮300,000 · үлдэгдэл ₮200,000/);
  await a.say('gift card Бат хас 149000 cabin');
  assert.match(await a.reply(), /Хасах ₮149,000[\s\S]*Үлдэх ₮51,000/);
  await a.press('Хасах');
  call = await a.rpc('use_gift_card');
  assert.deepEqual([call.p.card_id, call.p.amount, call.p.extra_amount, call.p.service, call.p.used_on], [4, 149000, 0, 'Cabin', today]);
  await a.say('gift card Бат хас 250000');
  assert.match(await a.reply(), /Нэмэлт төлбөр ₮50,000-ийг яаж төлсөн бэ/, 'a price over the balance asks how the rest was paid');
  await a.press('Бэлэн');
  assert.match(await a.reply(), /Хасах ₮200,000[\s\S]*Нэмэлт төлбөр ₮50,000 · Бэлэн/);
  await a.press('Болих');
  await a.say('gift card Сараа 95556677 олго 200000 хаан');
  await a.press('Олгох');
  call = await a.rpc('issue_gift_card');
  assert.deepEqual([call.p.recipient_name, call.p.recipient_phone, call.p.amount, call.p.payment_method, call.p.issued_on], ['Сараа', '95556677', 200000, 'khan', today]);

  /* ── packages ── */
  await a.say('Бат багц зар Recovery хаан');
  text = await a.reply();
  assert.match(text, /Багц Recovery · ₮500,000/);
  assert.match(text, /★ VIP · Бат · 99112233/);
  await a.press('Зарах');
  call = await a.rpc('package_checkout');
  assert.deepEqual([call.p.action, call.p.customer_id, call.p.package_id, call.p.amount, call.p.payment_method, call.p.sale_date], ['sell', 1, 3, 500000, 'khan', today]);
  await a.say('Бат багц зар Recovery хаан 200000');
  assert.match(await a.reply(), /Үлдэгдэл ₮300,000/, 'a part payment shows what is still owed');
  await a.press('Болих');
  await a.say('Бат багц оролт cabin');
  assert.match(await a.reply(), /Recovery — 0\/10 ашигласан/);
  await a.press('Бүртгэх');
  const visit = (await a.count(() => window.inserted)).at(-1);
  assert.deepEqual([visit.table, visit.contract_id, visit.service_id, visit.service_label, visit.staff_id, visit.used_on, visit.units], ['package_redemptions', 50, 1, 'Cabin', 7, today, 1]);
  await a.say('Бат багц');
  assert.match(await a.reply(), /Recovery — 1\/10 ашигласан · 9 үлдсэн/, 'the visit shows up in the balance straight away');

  /* ── the conversation from the floor: look someone up, then just say what is happening ── */
  await a.say('нарантуяа эгч');
  assert.match(await a.reply(), /Нарантуяа эгч · 70001234/);
  await a.press('Багц харах');
  assert.match(await a.reply(), /Эгчийн Oxygen багц — 1\/4 ашигласан · 3 үлдсэн/);
  await a.say('odoo negeer orj baina');
  text = await a.reply();
  assert.match(text, /Багцын оролтыг бүртгэх үү/, 'no name on the line: it is about the customer just looked up');
  assert.match(text, /Үйлчлүүлэгч Нарантуяа эгч/);
  assert.match(text, /Орох Oxygen/, 'the service comes from the package itself');
  assert.match(text, /Үлдэх 2 эрх/);
  await a.press('Бүртгэх');
  let entry = (await a.count(() => window.inserted)).at(-1);
  assert.deepEqual([entry.table, entry.contract_id, entry.service_id, entry.service_label, entry.units, entry.used_on], ['package_redemptions', 60, 7, 'Oxygen', 1, today]);
  assert.match(await a.reply(), /Үлдсэн эрх: 2/);
  // the memory carries on: a second visit, two at once
  await a.say('дахиад 2 удаа орлоо');
  assert.match(await a.reply(), /Орох Oxygen × 2[\s\S]*Үлдэх 0 эрх/);
  await a.press('Бүртгэх');
  assert.equal((await a.count(() => window.inserted)).at(-1).units, 2);
  await a.say('орлоо');
  assert.match(await a.reply(), /идэвхтэй багц алга/, 'a package that is used up takes no more visits');
  // a package that names its services: the one with sessions left is taken, a used-up one is refused
  await a.say('Батболд орлоо');
  assert.match(await a.reply(), /Орох Гоо сайхан/);
  await a.press('Болих');
  await a.say('Батболд орлоо cabin');
  assert.match(await a.reply(), /Cabin — энэ багцад 0 эрх үлдсэн/);
  await a.say('Батболд орлоо oxygen');
  assert.match(await a.reply(), /багцад Oxygen ороогүй/);
  // «болих» lets go of the customer too
  await a.say('болих');
  await a.say('орлоо');
  assert.match(await a.reply(), /Хэний багцын оролт вэ/);
  await a.say('болих');

  /* ── sports teams ── */
  await a.say('баг Аварга Дорж cabin');
  assert.match(await a.reply(), /Гишүүн Дорж[\s\S]*Cabin ₮25,000/);
  await a.press('Бүртгэх');
  call = await a.rpc('record_sports_member_visit');
  assert.deepEqual([call.p_team_id, call.p_member_id, call.p_devices, call.p_staff_id], [5, 9, [{ service_id: 1, price: 25000 }], 7]);
  await a.say('баг Аварга Дорж гоо сайхан');
  assert.match(await a.reply(), /үнэ тохируулаагүй/, 'a device with no team price is not guessed');
  await a.say('баг Аварга гишүүн нэм Болдоо');
  await a.press('Нэмэх');
  assert.deepEqual(await a.rpc('add_sports_member'), { p_team: 5, p_name: 'Болдоо' });

  /* ── reading, and going to a page ── */
  await a.say('өнөөдрийн хуваарь');
  assert.match(await a.reply(), /10:00 · Cabin · Сараа/);
  await a.say('маргааш cabin сул цаг');
  assert.match(await a.reply(), /сул цаг/);
  await a.say('99112233');
  assert.match(await a.reply(), /★ VIP · Бат · 99112233/);
  await a.say('өнөөдрийн борлуулалт');
  assert.match(await a.reply(), /борлуулалт/);
  await a.say('багц хуудас нээ');
  assert.match(await a.reply(), /Багц» хуудсыг нээлээ/);
  /* ── questions about what has been going on: answered, never acted on ── */
  const writes = () => a.count(() => window.rpcs.filter((c) => c.name !== 'is_admin').length + window.inserted.length + window.updates.length);
  const writesBefore = await writes();
  // Сараа came on a booking; Нарантуяа and Бат went in on their packages with no booking;
  // Золбоо is in the visit ledger only — and Нарантуяа, who is in both, is counted once
  await a.say('өнөөдөр хэдэн үйлчлүүлэгч үйлчлүүлсэн бэ');
  text = await a.reply();
  assert.match(text, /: 4 үйлчлүүлэгч үйлчлүүлсэн/);
  assert.match(text, /Захиалгаар: 1 хүн · 1 цаг/);
  assert.match(text, /Багцын оролт: 4 \(үүнээс захиалгагүй 3 хүн\)/, 'Бат, Нарантуяа and Золбоо came without a booking');
  assert.match(text, /Нэрс: [\s\S]*Сараа[\s\S]*Нарантуяа эгч[\s\S]*Золбоо/);
  await a.say('hichneen uilchluulegch unuudur uilchluulsen be');
  assert.match(await a.reply(), /: 4 үйлчлүүлэгч үйлчлүүлсэн/, 'the same question typed in Latin');
  // the shift plan
  await a.say('маргааш хэн ажиллах вэ');
  assert.match(await a.reply(), /ээлжинд: Denis$/m);
  await a.say('өнөөдрийн ээлж');
  assert.match(await a.reply(), /ээлжинд: Чимгээ, Denis 09:00–15:00/);
  await a.say('Denis хэзээ ажиллах вэ');
  assert.match(await a.reply(), new RegExp(`Denis — дараагийн ээлжүүд:[\\s\\S]*${today}[\\s\\S]*09:00–15:00[\\s\\S]*${tomorrow}`));
  await a.say('энэ долоо хоногийн ээлжийн хуваарь');
  assert.match(await a.reply(), /ээлжийн хуваарь:[\s\S]*Denis/);
  // packages, the way the sheet tracks them: per device, and who is running out
  await a.say('Батболд багц');
  assert.match(await a.reply(), /Хосолсон — Cabin 2\/2 · Гоо сайхан 0\/1 · нийт 1 үлдсэн/, 'what is left of each device');
  await a.say('хэний багц дуусах гэж байна');
  text = await a.reply();
  assert.match(text, /Дуусах дөхсөн багц: 1/);
  assert.match(text, /Батболд — 1 үлдсэн · Хосолсон/);
  await a.say('идэвхтэй багцтай хүмүүс хэн бэ');
  text = await a.reply();
  assert.match(text, /Идэвхтэй багц: 2/);
  assert.match(text, /Бат — 9 үлдсэн · Recovery/);
  await a.say('маргааш хэдэн захиалга байна');
  text = await a.reply();
  assert.match(text, /: 3 захиалга\./);
  assert.match(text, /Cabin: 3/);
  assert.match(text, /Цуцлагдсан: 1/);
  await a.say('өнөөдрийн орлого хэд вэ');
  text = await a.reply();
  assert.match(text, /нийт ₮194,000 · 2 гүйлгээ/, 'the booking payment and the extra income');
  assert.match(text, /Хаан: ₮100,000/);
  assert.match(text, /Бэлэн: ₮94,000/);
  await a.say('энэ долоо хоногийн орлого хэд вэ');
  assert.match(await a.reply(), /энэ долоо хоног \(\d{4}-\d\d-\d\d – \d{4}-\d\d-\d\d\)[\s\S]*нийт ₮194,000/);
  await a.say('аль төхөөрөмж хамгийн их вэ');
  assert.match(await a.reply(), /1\. Cabin — 1 цаг/);
  await a.say('хэн төлөөгүй байна');
  assert.match(await a.reply(), /төлбөр нь бүртгэгдээгүй захиалга алга/);
  await a.say('хэн ажиллаж байна');
  assert.match(await a.reply(), /Одоо 0 ажилтан ажиллаж байна[\s\S]*Чимгээ — [\s\S]*гарсан/);
  await a.say('дараагийн захиалга хэн бэ');
  assert.match(await a.reply(), /Дараагийн захиалга:[\s\S]*Cabin/);
  await a.say('маргааш хэдэн захиалга цуцлагдсан бэ');
  assert.match(await a.reply(), /: 1 захиалга цуцлагдсан[\s\S]*Батболд/);
  await a.say('энэ сард хэдэн багц зарагдсан бэ');
  assert.match(await a.reply(), /: 1 багц зарагдсан · багцын 7 оролт[\s\S]*Бат — Recovery/, 'four today plus the three earlier this month');
  // one customer's history, then a follow-up with no name
  await a.say('Сараа сүүлд хэзээ ирсэн бэ');
  text = await a.reply();
  assert.match(text, new RegExp(`Сүүлд ирсэн: ${today}`));
  assert.match(text, /Захиалгаар ирсэн: 1 удаа/);
  assert.match(text, /Төлсөн: ₮149,000 · 1 гүйлгээ/);
  await a.say('хэдэн удаа ирсэн бэ');
  assert.match(await a.reply(), /Сараа · 95556677[\s\S]*Захиалгаар ирсэн: 1 удаа/, 'no name: still about Сараа');
  assert.equal(await writes(), writesBefore, 'questions write nothing — not even ones that mention cancelling or selling');

  await a.say('цаг агаар ямар байна');
  assert.match(await a.reply(), /Ойлгосонгүй|олдсонгүй/);
  assert.deepEqual(a.errors, [], 'no script errors for an admin');

  /* ══ a staff member: the same limits as on the screens ══ */
  const s = await open(browser, 'staff', { paid: true });
  await s.say(`Бат ${nextWeek} 14:00 cabin`);
  assert.match(await s.reply(), /зөвхөн өнөөдөр, маргаашийн/);
  assert.equal(await s.count(() => window.inserted.length), 0);
  await s.press('маргааш');
  await s.press('Бүртгэх');
  assert.equal((await s.count(() => window.inserted))[0].starts_at, `${tomorrow}T14:00:00+08:00`);
  await s.say(`Бат 14:00-г ${nextWeek} болго`);
  assert.match(await s.reply(), /зөвхөн өнөөдөр, маргаашийн/, 'staff cannot move a booking beyond tomorrow');
  await s.say('Сараа устга');
  assert.match(await s.reply(), /зөвхөн админ устгана/, 'staff cannot delete a paid booking');
  assert.equal(await s.count(() => window.rpcs.filter((c) => c.name === 'delete_booking').length), 0);
  assert.deepEqual(s.errors, [], 'no script errors for staff');

  console.log('PASS staff assistant UI: booking, move, provider, status, delete, payment (split, remainder, refusal), extra income step by step, attendance, new customer, gift card (balance, deduct, issue), package (sell, visit, balance), team (visit, member), reading, navigation, staff limits. Mock data only.');
} finally { await browser.close(); }
