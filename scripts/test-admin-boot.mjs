// Smoke test: the admin page must boot without a script error (a module-level
// error leaves the login form dead). Mock Supabase; no network.
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const types={html:'text/html',js:'application/javascript',css:'text/css',svg:'image/svg+xml'};
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const url=new URL(route.request().url());
  if(url.hostname==='cdn.jsdelivr.net')return route.fulfill({contentType:types.js,body:`export const createClient=()=>({auth:{getSession:async()=>({data:{session:null}}),getUser:async()=>({data:{user:null}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}},signInWithPassword:async()=>{window.signedIn=true;return{error:null}},signOut:async()=>({})},rpc:async()=>({data:null}),from(){const q={select(){return q},order(){return q},is(){return q},eq(){return q},neq(){return q},range(){return q},maybeSingle(){return q},then(r){r({data:[],error:null})}};return q},channel(){const c={on(){return c},subscribe(){return c}};return c},removeChannel(){}});`});
  if(url.hostname!=='test.local')return route.abort();
  const path=url.pathname==='/'?'/admin.html':url.pathname;
  if(path==='/supabase-config.js')return route.fulfill({contentType:types.js,body:`window.CRYO_SUPABASE={url:'https://test.local',anonKey:'k'};`});
  try{return route.fulfill({contentType:types[path.split('.').pop()]||'text/plain',body:await readFile(new URL('..'+path,import.meta.url))});}catch{return route.fulfill({status:404,body:''});}});
 await page.goto('https://test.local/');await page.waitForTimeout(1500);
 assert.deepEqual(errors,[],'admin page booted with script errors');
 assert.equal(await page.locator('#authBtn').isVisible(),true);
 await page.locator('#au_email').fill('a@b.mn');await page.locator('#au_pass').fill('secret1');await page.locator('#authBtn').click();
 await page.waitForFunction(()=>window.signedIn===true,null,{timeout:5000});
 // Signed-in admin: every view renders against data without throwing.
 const page2=await browser.newPage();const errors2=[];page2.on('pageerror',e=>errors2.push(e.message));page2.on('dialog',d=>d.accept());
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ulaanbaatar'}).format(new Date());
 const data={profiles:[{id:'u1',email:'admin@test.mn',full_name:'Admin',role:'admin'}],
  services:[{id:1,slug:'cryocabin',name:'Cabin',category:'cryo',duration_minutes:3,price:149000,active:true,sort:1},{id:9,slug:'facial',name:'Гоо сайхан',category:'beauty',duration_minutes:60,price:150000,active:true,sort:9},{id:20,slug:'beauty-aroma',name:'Aroma therapy',category:'beauty',duration_minutes:60,price:139000,active:true,sort:901,parent_id:9}],
  staff:[{id:7,name:'Чимгээ',active:true,sort:1,user_id:'u1'}],customers:[{id:1,full_name:'Бат',phone:'99112233',is_vip:true}],
  bookings:[{id:1,ref:'B1',customer_name:'Бат',phone:'99112233',service_id:1,calendar_id:1,service:'Cabin',booked_date:day,booked_time:'10:00',starts_at:day+'T10:00:00+08:00',blocked_until:day+'T10:30:00+08:00',status:'confirmed',payment_status:'pending',booking_kind:'standard'},{id:2,ref:'B2',customer_name:'Бат',phone:'99112233',service_id:20,calendar_id:9,service:'Aroma therapy',booked_date:day,booked_time:'11:00',starts_at:day+'T11:00:00+08:00',blocked_until:day+'T12:00:00+08:00',status:'confirmed',payment_status:'pending',booking_kind:'standard'}],
  sales:[{id:5,sale_date:day,customer_name:'Клуб',services:'Oxygen balloon',golomt:45000,khan:0,cash:0,invoice:0,barter:0,refund:0,gift_card:0,internal_amount:0,total:45000,source:'manual'}],
  packages:[{id:3,slug:'p',name:'VIP багц',price:100,old_price:200,is_vip:true,active:true,service_units:[]}],gift_cards:[],gift_card_uses:[]};
 await page2.route('**/*',async route=>{const url=new URL(route.request().url());
  if(url.hostname==='cdn.jsdelivr.net')return route.fulfill({contentType:types.js,body:`const data=${JSON.stringify(data)};const session={user:{id:'u1',email:'admin@test.mn'}};
   export const createClient=()=>({auth:{getSession:async()=>({data:{session}}),getUser:async()=>({data:{user:session.user}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}},signOut:async()=>({})},rpc:async(name)=>({data:name==='is_admin'?true:[],error:null}),
   from(table){let single=false;const q={select(){return q},order(){return q},is(){return q},eq(){return q},neq(){return q},gte(){return q},lte(){return q},in(){return q},range(){return q},limit(){return q},maybeSingle(){single=true;return q},single(){single=true;return q},then(r){const rows=data[table]||[];r({data:single?(rows[0]||null):rows,error:null})}};return q},
   channel(){const c={on(){return c},subscribe(){return c}};return c},removeChannel(){}});`});
  if(url.hostname!=='test.local')return route.abort();
  const path=url.pathname==='/'?'/admin.html':url.pathname;
  if(path==='/supabase-config.js')return route.fulfill({contentType:types.js,body:`window.CRYO_SUPABASE={url:'https://test.local',anonKey:'k'};`});
  try{return route.fulfill({contentType:types[path.split('.').pop()]||'text/plain',body:await readFile(new URL('..'+path,import.meta.url))});}catch{return route.fulfill({status:404,body:''});}});
 await page2.goto('https://test.local/');await page2.locator('#bkBody tr').first().waitFor({state:'attached',timeout:10000});
 for(const id of ['navBookings','navReports','navServices','navPackages','navCustomers','navGiftCards']){const nav=page2.locator('#'+id);if(await nav.count()&&await nav.isVisible())await nav.click();}
 await page2.locator('[data-view="bookings"]').first().click();
 assert.match(await page2.locator('#bkBody').innerText(),/Бат/);
 // one row for the customer's two same-day slots; open checkout; nothing prefilled; clicking a method takes the total
 await page2.locator('#bkBody select').first().selectOption('paid');
 await page2.locator('#ledForm').waitFor({state:'visible'});
 assert.equal(await page2.locator('#f_cash').inputValue(),'0');assert.equal(await page2.locator('#f_invoice').isEnabled(),true);
 await page2.locator('#f_khan').focus();assert.equal(await page2.locator('#f_khan').inputValue(),'288000');
 assert.match(await page2.locator('#ledFormTotal').innerText(),/Төлбөр бүрэн/);
 // Extra income sits behind its button on the sales page.
 await page2.locator('#navReports').click();assert.equal(await page2.locator('#extraIncomePanel').isVisible(),false);
 await page2.locator('#xiOpen').click();assert.equal(await page2.locator('#extraIncomePanel').isVisible(),true);assert.equal(await page2.locator('#xiKind option').count(),2);
 await page2.locator('#xiCancel').click();assert.equal(await page2.locator('#extraIncomePanel').isVisible(),false);
 assert.deepEqual(errors2,[],'signed-in dashboard threw');
 // Staff account: the sales page is read-only, but the extra-income button and form must still be there.
 const page3=await browser.newPage();const errors3=[];page3.on('pageerror',e=>errors3.push(e.message));
 await page3.route('**/*',async route=>{const url=new URL(route.request().url());
  if(url.hostname==='cdn.jsdelivr.net')return route.fulfill({contentType:types.js,body:`const data=${JSON.stringify({...data,profiles:[{id:'u1',email:'staff@test.mn',full_name:'Staff',role:'staff'}]})};const session={user:{id:'u1',email:'staff@test.mn'}};
   export const createClient=()=>({auth:{getSession:async()=>({data:{session}}),getUser:async()=>({data:{user:session.user}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}},signOut:async()=>({})},rpc:async(name)=>({data:name==='is_admin'?false:[],error:null}),
   from(table){let single=false;const q={select(){return q},order(){return q},is(){return q},eq(){return q},neq(){return q},gte(){return q},lte(){return q},in(){return q},range(){return q},limit(){return q},maybeSingle(){single=true;return q},single(){single=true;return q},then(r){const rows=data[table]||[];r({data:single?(rows[0]||null):rows,error:null})}};return q},
   channel(){const c={on(){return c},subscribe(){return c}};return c},removeChannel(){}});`});
  if(url.hostname!=='test.local')return route.abort();
  const path=url.pathname==='/'?'/admin.html':url.pathname;
  if(path==='/supabase-config.js')return route.fulfill({contentType:types.js,body:`window.CRYO_SUPABASE={url:'https://test.local',anonKey:'k'};`});
  try{return route.fulfill({contentType:types[path.split('.').pop()]||'text/plain',body:await readFile(new URL('..'+path,import.meta.url))});}catch{return route.fulfill({status:404,body:''});}});
 await page3.goto('https://test.local/');await page3.locator('#xiOpen').waitFor({state:'visible',timeout:10000});
 assert.equal(await page3.locator('#repSales').isVisible(),false,'staff still cannot open the manual sale form');
 await page3.locator('#xiOpen').click();assert.equal(await page3.locator('#xiSave').isVisible(),true);assert.equal(await page3.locator('#xiCancel').isVisible(),true);
 assert.deepEqual(errors3,[],'staff dashboard threw');
 assert.deepEqual(errors,[]);console.log('PASS admin page boots without script errors and the login form submits; signed-in dashboard, grouped checkout and split-payment form render. Mock data only.');
}finally{await browser.close();}
