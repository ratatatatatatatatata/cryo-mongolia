import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://test.local/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: `<div id="packageOperations"></div><select id="sharedStaffSelect"><option value="7">Ажилтан</option></select><script>window.CRYO_SUPABASE={};window.saved=[];window.addEventListener('cryo:sale-saved',e=>window.saved.push(e.detail));</script><script type="module" src="/package-workspace.js"></script>` });
    return route.fulfill({ contentType: 'application/javascript', body: await readFile(new URL('..' + path, import.meta.url), 'utf8') });
  });
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ contentType: 'application/javascript', body: `
    const records={customers:[{id:1,full_name:'Бат-Эрдэнэ',phone:'99112233'},{id:2,full_name:'Сараа'}],packages:[{id:4,name:'Recovery',price:500000}],staff:[{id:7,name:'Ажилтан',active:true}],profiles:{role:'staff'},package_sales_leads:[],customer_package_contracts:[],package_redemptions:[],services:[]};
    export const createClient=()=>({auth:{getSession:async()=>({data:{session:{user:{id:'test',email:'staff@test.local'}}}}),onAuthStateChange(){}},from(table){let payload;const q={select(){return q},order(){return q},is(){return q},eq(){return q},neq(){return q},range(){return q},maybeSingle(){return q},insert(value){payload=value;return q},single(){return q},then(resolve){resolve({data:payload?{id:123,...payload}:records[table],error:null})}};return q}});
  ` }));
  await page.goto('https://test.local/');
  await page.locator('#pkgLeadPurchased option[value="4"]').waitFor({state:'attached'});
  await page.locator('#pkgSaleSearch').fill('bat erdene');
  assert.equal(await page.locator('#pkgLeadCustomer option').count(), 2);
  await page.locator('#pkgLeadCustomer').selectOption('1');
  await page.locator('#pkgLeadPurchased').selectOption('4');
  assert.equal(await page.locator('#pkgSalePrice').inputValue(), '₮500,000');
  assert.equal(await page.locator('#pkgSaleAmount').inputValue(), '500000');
  await page.locator('#pkgSaleBank').selectOption('khan');
  await page.locator('#pkgLeadSave').click();
  await page.waitForFunction(()=>window.saved.length===1);
  const [sale] = await page.evaluate(()=>window.saved);
  assert.equal(sale.customer_id,1);
  assert.equal(sale.khan,500000);
  assert.equal(sale.services,'Багц: Recovery');
  assert.equal(sale.staff_id,7);
  assert.equal(sale.created_by,'test');
  assert.equal(await page.locator('#pkgSaleAmount').inputValue(),'');
  assert.deepEqual(errors,[]);
  console.log('Package sales browser test passed (mock database; no live writes)');
} finally { await browser.close(); }
