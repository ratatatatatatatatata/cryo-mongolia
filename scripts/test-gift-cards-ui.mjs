import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('https://test.local/**',async route=>{const path=new URL(route.request().url()).pathname;if(path==='/')return route.fulfill({contentType:'text/html',body:`<button id="navGiftCards"></button><section id="giftCardsPanel"></section><select id="sharedStaffSelect"><option value="7">Ажилтан</option></select><script>window.CRYO_SUPABASE={};window.calls=[];</script><script type="module" src="/gift-cards.js"></script>`});return route.fulfill({contentType:'application/javascript',body:await readFile(new URL('..'+path,import.meta.url),'utf8')});});
 await page.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({contentType:'application/javascript',body:`
 const records={gift_cards:[{id:1,code:'GC-0001',issued_on:'2026-11-01',recipient_name:'Сараа',recipient_phone:'99112233',buyer_name:'Бат',amount:100000,payment_method:'cash',staff_id:7}],gift_card_uses:[{id:1,card_id:1,used_on:'2026-11-05',amount:100000,staff_id:7}],staff:[{id:7,name:'Ажилтан',active:true}]};
 export const createClient=()=>({auth:{getSession:async()=>({data:{session:{user:{id:'u',email:'s@test.local'}}}}),onAuthStateChange(){}},async rpc(name,args){window.calls.push({name,p:args?.p});if(name==='is_admin')return {data:false};const p=args.p;
  if(name==='issue_gift_card'){const card={id:records.gift_cards.length+1,code:'GC-000'+(records.gift_cards.length+1),issued_on:p.issued_on,recipient_name:p.recipient_name,recipient_phone:p.recipient_phone,buyer_name:p.buyer_name,amount:p.amount,payment_method:p.payment_method,staff_id:p.staff_id};records.gift_cards.push(card);return {data:{card,sale:p.payment_method==='promo'?null:{id:9}}};}
  if(name==='use_gift_card'){const use={id:5+records.gift_card_uses.length,extra_amount:p.extra_amount||0,extra_method:p.extra_method,card_id:p.card_id,used_on:p.used_on,amount:p.amount,service:p.service,staff_id:p.staff_id};records.gift_card_uses.push(use);return {data:{use,sale:p.extra_amount?{id:77,khan:p.extra_amount}:null}};}
  return {data:{}};},from(table){const q={select(){return q},order(){return q},range(){return q},then(resolve){resolve({data:records[table],error:null})}};return q;}});`}));
 await page.goto('https://test.local/');await page.locator('#gcBody tr').first().waitFor();
 assert.match(await page.locator('#gcBody').innerText(),/Gift card алга/,'spent card hidden from the default "with balance" view');
 await page.locator('#gcAdd').click();await page.locator('#gcDate').fill('2026-11-10');await page.locator('#gcAmount').fill('200000');await page.locator('#gcMethod').selectOption('khan');
 await page.locator('#gcBuyer').fill('Болд');await page.locator('#gcRecipient').fill('Номин');await page.locator('#gcRecipientPhone').fill('88112233');await page.locator('#gcSave').click();
 await page.waitForFunction(()=>window.calls.some(c=>c.name==='issue_gift_card'));
 const issued=await page.evaluate(()=>window.calls.find(c=>c.name==='issue_gift_card').p);assert.equal(issued.issued_on,'2026-11-10');assert.equal(issued.amount,200000);assert.equal(issued.recipient_name,'Номин');assert.equal(issued.staff_id,7);
 await page.locator('#gcBody tr',{hasText:'Номин'}).waitFor();assert.match(await page.locator('#gcBody').innerText(),/GC-0002[\s\S]*₮200,000/);
 await page.locator('#gcUseAmount').fill('150000');await page.locator('#gcUseService').fill('LedPro');await page.locator('#gcUseSave').click();
 await page.waitForFunction(()=>window.calls.some(c=>c.name==='use_gift_card'));
 await page.waitForFunction(()=>document.querySelector('#gcBody').innerText.includes('₮50,000'));
 assert.match(await page.locator('#gcDetail').innerText(),/LedPro/);assert.equal(await page.locator('#gcUseAmount').inputValue(),'50000');
 // Service costs more than the card holds → extra payment with its own method.
 await page.locator('#gcUseAmount').fill('80000');assert.equal(await page.locator('#gcExtraField').isVisible(),true);assert.match(await page.locator('#gcUseSummary').innerText(),/Нэмэлт төлбөр ₮30,000/);
 await page.locator('#gcExtraMethod').selectOption('khan');await page.locator('#gcUseSave').click();
 await page.waitForFunction(()=>window.calls.filter(c=>c.name==='use_gift_card').length===2);
 const extra=await page.evaluate(()=>window.calls.filter(c=>c.name==='use_gift_card')[1].p);assert.equal(extra.amount,50000);assert.equal(extra.extra_amount,30000);assert.equal(extra.extra_method,'khan');
 await page.locator('#gcSearch').fill('Номин');await page.locator('#gcFilter').selectOption('all');assert.match(await page.locator('#gcBody').innerText(),/Номин/);assert.doesNotMatch(await page.locator('#gcBody').innerText(),/Сараа/);await page.locator('#gcSearch').fill('');
 await page.locator('#gcFilter').selectOption('all');assert.match(await page.locator('#gcBody').innerText(),/Сараа/);
 // Promotion: no payment, labelled, and the form explains that no income is recorded.
 await page.locator('#gcAdd').click();await page.locator('#gcMethod').selectOption('promo');assert.match(await page.locator('#gcIncomeNote').innerText(),/Урамшуулал/);
 await page.locator('#gcAmount').fill('30000');await page.locator('#gcRecipient').fill('Promo хүн');await page.locator('#gcSave').click();
 await page.waitForFunction(()=>window.calls.filter(c=>c.name==='issue_gift_card').length===2);
 assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name==='issue_gift_card')[1].p.payment_method),'promo');
 await page.locator('#gcBody tr',{hasText:'Promo хүн'}).waitFor();assert.match(await page.locator('#gcBody tr',{hasText:'Promo хүн'}).innerText(),/Урамшуулал/);
 assert.deepEqual(errors,[]);console.log('PASS gift card list, issue with exact date, recipient + amount shown, deduct usage, extra payment, search by name, promotional card. Mock data only.');
}finally{await browser.close();}
