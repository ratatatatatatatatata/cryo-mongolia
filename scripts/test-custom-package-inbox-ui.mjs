import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.hostname!=='test.local')return route.abort();
  if(url.pathname!=='/')return route.fulfill({contentType:url.pathname.endsWith('.css')?'text/css':'application/javascript',body:await readFile(new URL('..'+url.pathname,import.meta.url),'utf8')});
  return route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/shared.css"><link rel="stylesheet" href="/admin.css"><button id="edit">Багц засах</button><button id="navStaffRequests">Хүсэлт <span id="staffRequestBadge"></span></button><button id="asstRequests">Хүсэлт / явц</button><p id="asstEscalationStatus"></p><p id="staffRequestScope"></p><button id="staffRequestRefresh">Дахин шалгах</button><form id="staffRequestForm"><select id="staffRequestOperation"><option value="package">Багц</option></select><textarea id="staffRequestSummary" minlength="5" required></textarea><button id="staffRequestSend">Илгээх</button></form><p id="staffRequestStatus"></p><div id="staffRequestList"></div><script type="module">
 import {createPackageEditor} from '/package-customization.js';import {createImprovementInbox} from '/staff-improvement-inbox.js';
 window.calls=[];window.who={userId:'u1',staffId:7,admin:false};window.fail=null;window.saved=null;window.requests=[];
 window.contract={id:10,customer_label:'Зохиомол хүн',package_label:'Oxygen 4',purchased_on:'2026-01-01',expires_on:null,total_units:4,status:'active',agreed_price:100000,service_units:[{service_id:1,service_name:'Oxygen',units:4}]};
 const sb={async rpc(name,{p}){window.calls.push({name,p});if(window.fail)return {error:window.fail};
 if(name==='customer_package_editor'){if(p.action==='read')return {data:{contract:structuredClone(window.contract),history:[{id:1,service_id:1,units:1}],token:'v1'}};
 window.contract={...window.contract,package_label:p.package_label,expires_on:p.expires_on,service_units:p.items,total_units:p.items.reduce((s,x)=>s+x.units,0)};return {data:{contract:window.contract}};}
 if(p.action==='list')return {data:{requests:window.requests,is_admin:window.who.admin,open_count:window.requests.filter(r=>r.status!=='done').length}};
 if(p.action==='report'){let r={id:window.requests.length+1,request_id:p.request_id,category:p.category,operation:p.operation,summary:p.category==='suggestion'?p.summary:'Туслах хүсэлтийг гүйцэтгэж чадсангүй',status:'new',staff_name:'Ажилтан',occurrences:1,revision:1,updates:[],created_at:new Date().toISOString(),last_seen_at:new Date().toISOString()};window.requests.push(r);return {data:{request:r}};}
 if(p.action==='update'){const r=window.requests.find(r=>r.id===p.id);Object.assign(r,{status:p.status,admin_note:p.admin_note,revision:r.revision+1});return {data:{request:r}};}
 }};
 window.editor=createPackageEditor({sb,getStaffId:()=>window.who.staffId,getServices:()=>[{id:1,name:'Oxygen',active:true},{id:2,name:'Cabin',active:true}],onSaved:c=>{window.saved=c;}});
 document.getElementById('edit').onclick=()=>window.editor.open(10);
 window.inbox=createImprovementInbox({getClient:()=>sb,getContext:()=>window.who,openView:()=>{}});await window.inbox.refresh();window.ready=true;
 </script>`});
 });
 await page.goto('https://test.local/');await page.waitForFunction(()=>window.ready);
 await page.locator('#edit').click();await page.locator('[data-base]').waitFor();
 assert.equal(await page.locator('[data-base]').inputValue(),'');assert.equal(await page.locator('[data-save]').isEnabled(),false);
 await page.locator('[data-base]').fill('4');await page.locator('[data-mode]').selectOption('percent');await page.locator('[data-bonus]').fill('50');
 assert.match(await page.locator('output').innerText(),/нийт 6.*Ашигласан 1.*Үлдсэн 5/);
 await page.locator('[name=reason]').fill('Үндсэн 4 + урамшуулал 2 баталсан');
 if(process.env.CRYO_UI_SCREENSHOT){await page.locator('dialog').evaluate(e=>e.scrollTop=0);await page.screenshot({path:process.env.CRYO_UI_SCREENSHOT,fullPage:true});}
 assert.equal(await page.locator('dialog').evaluate(e=>e.scrollWidth<=e.clientWidth),true);
 await page.locator('[data-save]').click();await page.waitForFunction(()=>!!window.saved);
 const save=await page.evaluate(()=>window.calls.find(c=>c.p.action==='save').p);assert.equal(save.items[0].units,6);assert.equal(save.items[0].bonus_mode,'percent');assert(!('agreed_price' in save));assert.equal(await page.locator('dialog').isVisible(),false);
 await page.locator('#edit').click();await page.locator('[data-base]').waitFor();await page.locator('[data-base]').fill('3');await page.locator('[name=reason]').fill('Туршилтын засвар');assert.equal(await page.locator('[data-save]').isEnabled(),false); // 3 * 50% fractional
 await page.locator('[data-base]').fill('4');await page.evaluate(()=>window.who.staffId=8);await page.locator('[data-save]').click();assert.match(await page.locator('[data-status]').innerText(),/ажилтан солигдсон/);assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.p.action==='save').length),1);
 await page.locator('[data-close]').click();await page.evaluate(()=>{window.who.staffId=7;});
 await page.evaluate(()=>window.inbox.report('unsupported','unknown'));assert.match(await page.locator('#asstEscalationStatus').innerText(),/Админд #1/);assert.equal(await page.locator('#staffRequestBadge').innerText(),'1');
 await page.evaluate(()=>window.inbox.report('unsupported','unknown'));assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.p.category==='unsupported').length),1);
 await page.locator('#staffRequestSummary').fill('Багцын тайлбарыг илүү ойлгомжтой харах боломж хэрэгтэй');await page.locator('#staffRequestSend').click();await page.waitForFunction(()=>window.requests.length===2);
 assert.equal(await page.locator('#staffRequestList [data-save]').count(),0);
 await page.evaluate(async()=>{window.who.admin=true;await window.inbox.refresh();});
 const row=page.locator('[data-request="1"]');await row.locator('[data-status]').selectOption('planned');await row.locator('[data-note]').fill('Шинэ хувилбарт оруулахаар төлөвлөсөн');
 await page.locator('#staffRequestRefresh').click();assert.equal(await row.locator('[data-note]').inputValue(),'Шинэ хувилбарт оруулахаар төлөвлөсөн');
 await row.locator('[data-save]').click();await page.waitForFunction(()=>window.requests[0].status==='planned');
 await page.evaluate(async()=>{window.who.admin=false;await window.inbox.refresh();});assert.match(await page.locator('#staffRequestList').innerText(),/Шинэ хувилбарт оруулахаар төлөвлөсөн/);
 await page.evaluate(async()=>{window.fail={code:'PGRST202',message:'unavailable'};await window.inbox.report('save_failed','payment');});assert.match(await page.locator('#asstEscalationStatus').innerText(),/автоматаар илгээгдээгүй/);
 assert.deepEqual(errors,[]);console.log('PASS: mobile editor, unknown split, percentage, preview/confirm, immutable payment, staff switch, private notice, dedupe, admin reply, preserved draft and truthful failed delivery. Mock browser only.');
}finally{await browser.close();}
