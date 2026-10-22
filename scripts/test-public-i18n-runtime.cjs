const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function fixture(url='https://example.test/?lang=en', blocked=false) {
  let observerOptions;
  const store = new Map();
  const document = {
    documentElement: {lang:'mn'},
    querySelector(){return null}, querySelectorAll(){return []},
    createTreeWalker(){return {nextNode(){return null}}},
    dispatchEvent(){}, addEventListener(){},
  };
  const context = vm.createContext({
    window:{}, document, location:new URL(url), URL,
    localStorage:{getItem(k){if(blocked)throw Error('blocked');return store.get(k)},setItem(k,v){if(blocked)throw Error('blocked');store.set(k,v)}},
    history:{state:null,replaceState(){}},
    NodeFilter:{SHOW_TEXT:4,FILTER_ACCEPT:1,FILTER_REJECT:2},
    MutationObserver:class{observe(el,opts){observerOptions=opts}disconnect(){}},
    CustomEvent:class{}, queueMicrotask,
  });
  for(const f of ['public-copy.js','public-device-copy.js','public-ui-copy.js','public-i18n.js']) vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),context);
  return {context,store,document,get observerOptions(){return observerOptions}};
}
const f=fixture();
const i=f.context.window.CryoI18n;
assert.equal(i.language,'en');
for(const [mn,en] of [
  ['60 минут · цагийн сонголт 30 минутын зайтай','60 min · appointment times every 30 min'],
  ['60 минут + 2 минутын төхөөрөмж бэлтгэх завсар','60 min + 2 min equipment preparation'],
  ['Бүтэн биеийн бариа · 60 мин','Full-body massage · 60 min'],
  ['27% хөнгөлөлт','27% off'],['1 үйлчилгээ','1 service'],['2 үйлчилгээ','2 services'],
  ['45 минут','45 min'],['1–3 мин','1–3 min'],['ГОЛОМТ БАНК — QPAY','Golomt Bank — QPAY'],
  ['Багцын эрхээр','Using your package'],['Үйлчилгээ','Services'],
  ['<img src=x onerror=alert(1)>','<img src=x onerror=alert(1)>'],
  ['test@example.invalid','test@example.invalid']
]) assert.equal(i.t(mn),en,mn);
assert.equal(f.document.documentElement.lang,'en');
assert.equal(f.store.get('cryo-public-language'),'en');
i.setLanguage('mn');assert.equal(i.t('Үйлчилгээ'),'Үйлчилгээ');
assert.equal(i.t('RECOVERY CENTER'),'НӨХӨН СЭРГЭЭХ ТӨВ');
i.setLanguage('invalid');assert.equal(i.language,'mn');
i.setLanguage('en');assert.equal(i.t('RECOVERY CENTER'),'RECOVERY CENTER');
assert.ok(!f.observerOptions.attributeFilter.includes('value'),'Input values are not observed');
for(const p of ['/admin','/admin.html','/erp/','/unknown']) assert.equal(fixture('https://example.test'+p).context.window.CryoI18n,undefined,p);
const privateMode=fixture('https://example.test/?lang=en',true);
privateMode.context.window.CryoI18n.setLanguage('mn');assert.equal(privateMode.document.documentElement.lang,'mn');
assert.equal(fixture('https://example.test/?lang=bad').document.documentElement.lang,'mn');
console.log('PASS: dynamic copy, currency/service invariants, locale persistence, blocked storage, invalid locale and public-only route guards.');
