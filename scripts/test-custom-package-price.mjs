import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const fields=Object.fromEntries(['pkgCustomBase','pkgCustomDiscount','pkgSalePrice','pkgSaleAmount','pkgCustomSummary'].map(id=>[id,{value:'',textContent:''}]));
const context=vm.createContext({$:id=>fields[id],money:n=>String(n)});
const source=fs.readFileSync(new URL('../package-workspace.js',import.meta.url),'utf8');
vm.runInContext(source.slice(source.indexOf('function updateCustomPackagePrice()'),source.indexOf('function setPackageSaleOpen(')),context);
for (const [base,discount,expected] of [[1000000,15,850000],[150000,12.5,131250],[100000,0,100000],[100000,100,0],[100000,101,''],[-1,10,'']]) {
 fields.pkgCustomBase.value=String(base); fields.pkgCustomDiscount.value=String(discount);
 vm.runInContext('updateCustomPackagePrice()',context);
 assert.equal(fields.pkgSaleAmount.value,expected);
}
console.log('6 custom package price checks passed');
