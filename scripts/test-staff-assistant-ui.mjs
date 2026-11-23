// The staff assistant in the real admin page, against a mock database (no live writes).
// Run: node scripts/test-staff-assistant-ui.mjs   (needs playwright)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const types = { html: 'text/html', js: 'application/javascript', css: 'text/css', svg: 'image/svg+xml' };
const ubDay = (offset = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar' }).format(new Date(Date.now() + offset * 86400000));
const today = ubDay(0), tomorrow = ubDay(1), nextWeek = ubDay(7);

const dataFor = (role) => ({
  profiles: [{ id: 'u1', email: 'me@test.mn', full_name: 'Тест', role }],
  services: [
    { id: 1, slug: 'cryocabin', name: 'Cabin', category: 'cryo', duration_minutes: 3, price: 149000, active: true, sort: 1 },
    { id: 9, slug: 'facial', name: 'Гоо сайхан', category: 'beauty', duration_minutes: 60, price: 150000, active: true, sort: 9 },
  ],
  staff: [{ id: 7, name: 'Чимгээ', active: true, sort: 1, user_id: 'u1' }],
  customers: [
    { id: 1, full_name: 'Бат', phone: '99112233', is_vip: true },
    { id: 2, full_name: 'Батболд', phone: '88001122' },
  ],
  bookings: [{ id: 1, ref: 'B1', customer_name: 'Сараа', phone: '95556677', service_id: 1, calendar_id: 1, service: 'Cabin', booked_date: today, booked_time: '10:00', starts_at: today + 'T10:00:00+08:00', blocked_until: today + 'T10:30:00+08:00', status: 'confirmed', payment_status: 'pending', booking_kind: 'standard' }],
  sales: [], packages: [], gift_cards: [], gift_card_uses: [], customer_package_contracts: [], package_redemptions: [],
});

async function open(browser, role) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: types.js, body: `
      const data=${JSON.stringify(dataFor(role))};const session={user:{id:'u1',email:'me@test.mn'}};window.inserted=[];let nextId=100;
      export const createClient=()=>({auth:{getSession:async()=>({data:{session}}),getUser:async()=>({data:{user:session.user}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}},signOut:async()=>({})},
       rpc:async(name)=>({data:name==='is_admin'?${role !== 'staff'}:[],error:null}),
       from(table){let single=false,written=null;const q={select(){return q},order(){return q},is(){return q},eq(){return q},neq(){return q},gte(){return q},lte(){return q},in(){return q},range(){return q},limit(){return q},maybeSingle(){single=true;return q},single(){single=true;return q},
         insert(value){written=(Array.isArray(value)?value:[value]).map(row=>({id:nextId++,booked_date:String(row.starts_at||'').slice(0,10),booked_time:String(row.starts_at||'').slice(11,16),
           /* the real table fills this in itself: the slot is held for whole half hours */
           blocked_until:row.starts_at?new Date(Date.parse(row.starts_at)+Math.max(30,Math.ceil(((data.services.find(s=>s.id===row.service_id)||{}).duration_minutes||30)/30)*30)*60000).toISOString():undefined,...row}));written.forEach(row=>window.inserted.push({table,...row}));(data[table]=data[table]||[]).push(...written);return q},
         then(r){const rows=written||data[table]||[];r({data:single?(rows[0]||null):rows,error:null})}};return q},
       channel(){const c={on(){return c},subscribe(){return c}};return c},removeChannel(){}});` });
    if (url.hostname !== 'test.local') return route.abort();
    const path = url.pathname === '/' ? '/admin.html' : url.pathname;
    if (path === '/supabase-config.js') return route.fulfill({ contentType: types.js, body: `window.CRYO_SUPABASE={url:'https://test.local',anonKey:'k'};` });
    try { return route.fulfill({ contentType: types[path.split('.').pop()] || 'text/plain', body: await readFile(new URL('..' + path, import.meta.url)) }); }
    catch { return route.fulfill({ status: 404, body: '' }); }
  });
  await page.goto('https://test.local/');
  await page.locator('#asstOpen').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#asstOpen').click();
  const say = async (text) => { await page.locator('#asstInput').fill(text); await page.locator('#asstInput').press('Enter'); await page.waitForTimeout(150); };
  const last = () => page.locator('#asstLog .asst-msg.bot').last();
  const press = async (label) => { await last().locator('button', { hasText: label }).first().click(); await page.waitForTimeout(200); };
  return { page, errors, say, last, press };
}

const browser = await chromium.launch({ headless: true });
try {
  /* ── an admin: any day is allowed ── */
  const a = await open(browser, 'admin');
  assert.match(await a.last().innerText(), /Болд маргааш 14:00 cryo cabin/, 'opens with what it can do');

  // the headline case: existing customer, exact name, one confirmation, one insert
  await a.say('Бат маргааш 14:00 cabin');
  let text = await a.last().innerText();
  assert.match(text, /Ингэж бүртгэх үү/);
  assert.match(text, /Бат · 99112233/, 'the exact name wins over «Батболд»');
  assert.match(text, /Cabin · 3 мин/);
  assert.match(text, new RegExp(tomorrow));
  assert.equal(await a.page.evaluate(() => window.inserted.length), 0, 'nothing is written before the employee confirms');
  await a.press('Бүртгэх');
  let inserted = await a.page.evaluate(() => window.inserted);
  assert.equal(inserted.length, 1);
  assert.deepEqual(
    [inserted[0].table, inserted[0].customer_name, inserted[0].phone, inserted[0].service_id, inserted[0].starts_at, inserted[0].status, inserted[0].staff_id, inserted[0].booking_kind],
    ['bookings', 'Бат', '99112233', 1, `${tomorrow}T14:00:00+08:00`, 'confirmed', 7, 'standard']);
  assert.match(inserted[0].ref, /^STAFF-/);
  assert.match(await a.last().innerText(), /Бүртгэлээ: Бат · Cabin/);

  // a slot that is taken is refused, with free times offered instead
  await a.say('Бат өнөөдөр 10:00 cabin');
  text = await a.last().innerText();
  assert.match(text, /завгүй байна/);
  assert.match(text, /Сараа/, 'says who has it');
  // the slot it just booked is taken too
  await a.say('болих');
  await a.say(`Батболд ${tomorrow} 14:00 cabin`);
  assert.match(await a.last().innerText(), /завгүй байна/, 'its own booking blocks the slot straight away');
  await a.press('14:30');
  assert.match(await a.last().innerText(), /Батболд · 88001122/);
  await a.press('Болих');
  assert.equal(await a.page.evaluate(() => window.inserted.length), 1, 'cancelling writes nothing');

  // a partial name asks which one
  await a.say('Ба маргааш 15:00 cabin');
  text = await a.last().innerText();
  assert.match(text, /2 үйлчлүүлэгч байна/);
  await a.press('Батболд');
  assert.match(await a.last().innerText(), /Батболд · 88001122/);
  await a.press('Болих');

  // a new customer: asks for the phone, then books and saves them
  await a.say('Тэмүүлэн маргааш cabin 16:30');
  assert.match(await a.last().innerText(), /бүртгэлгүй байна/);
  await a.say('99887766');
  text = await a.last().innerText();
  assert.match(text, /Тэмүүлэн · 99887766/);
  assert.match(text, /Шинэ үйлчлүүлэгчээр/);
  await a.press('Бүртгэх');
  await a.page.waitForTimeout(300);
  inserted = await a.page.evaluate(() => window.inserted);
  assert.ok(inserted.some((row) => row.table === 'bookings' && row.customer_name === 'Тэмүүлэн' && row.phone === '99887766'));
  assert.ok(inserted.some((row) => row.table === 'customers' && row.full_name === 'Тэмүүлэн' && row.phone === '99887766'), 'the new customer is saved');

  // missing pieces are asked for one at a time
  await a.say('Бат захиал');
  assert.match(await a.last().innerText(), /Аль төхөөрөмж/);
  await a.press('Cabin');
  assert.match(await a.last().innerText(), /Хэдэн цагт/);
  await a.say('болих');

  // an hour-long service keeps to its own grid
  await a.say('Бат маргааш 14:30 гоо сайхан');
  assert.match(await a.last().innerText(), /эхлэх боломжгүй/);
  await a.say('болих');
  // outside opening hours
  await a.say('Бат маргааш 22:00 cabin');
  assert.match(await a.last().innerText(), /09:00–21:00/);
  await a.say('болих');

  // the read-only requests
  await a.say('өнөөдрийн хуваарь');
  assert.match(await a.last().innerText(), /10:00 · Cabin · Сараа/);
  await a.say('маргааш cabin сул цаг');
  text = await a.last().innerText();
  assert.match(text, /сул цаг/);
  assert.ok(!/\b14:00\b/.test(text) && /\b14:30\b/.test(text), 'the booked slots are not offered');
  await a.say('99112233');
  assert.match(await a.last().innerText(), /★ VIP · Бат · 99112233/);
  await a.say('Бат багц');
  assert.match(await a.last().innerText(), /Багц бүртгэгдээгүй/);
  await a.say('цаг агаар ямар байна');
  assert.match(await a.last().innerText(), /Ойлгосонгүй|олдсонгүй/);
  assert.deepEqual(a.errors, [], 'no script errors for an admin');

  /* ── a staff member: today and tomorrow only, exactly as on the booking form ── */
  const s = await open(browser, 'staff');
  await s.say(`Бат ${nextWeek} 14:00 cabin`);
  assert.match(await s.last().innerText(), /зөвхөн өнөөдөр, маргаашийн/);
  assert.equal(await s.page.evaluate(() => window.inserted.length), 0);
  await s.press('маргааш');
  assert.match(await s.last().innerText(), /Ингэж бүртгэх үү/);
  await s.press('Бүртгэх');
  inserted = await s.page.evaluate(() => window.inserted);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].starts_at, `${tomorrow}T14:00:00+08:00`);
  assert.deepEqual(s.errors, [], 'no script errors for staff');

  console.log('PASS staff assistant UI: confirm-before-write, taken slots, name choice, new customer, missing pieces, grid and hours, read-only requests, staff day limit. Mock data only.');
} finally { await browser.close(); }
