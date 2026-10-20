import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import {readPackages,datesInCell,isRed} from './package-workbook.mjs';
assert.deepEqual(datesInCell({t:'n',v:46100,z:'m/d'},2025),['2026-03-19']);
assert.deepEqual(datesInCell({v:'2026.01.02; 1/9 milk; 14/9/2025'},2026),['2026-01-02','2026-01-09','2025-09-14']);
assert.equal(isRed({s:{patternType:'solid',fgColor:{rgb:'EA9999'}}}),true);
const ws=XLSX.utils.aoa_to_sheet([
 ['ХАРИЛЦАГЧИЙН НЭР','Багцын тоо','Багц эхэлсэн огноо','Cryo Cabin 3',null,null,'Notice'],
 ['Customer','Test','2026.01.01','1/2',null,null,'1/5'],
 ['New','Test',null,null,null,null],
 ['ХАРИЛЦАГЧИЙН НЭР','Мэдээлэл','Багц эхэлсэн огноо','Oxygen 2',null,'Notes'],
 ['Customer2',null,null,'1/3',null,'1/9']
]);
ws['!merges']=[{s:{r:0,c:3},e:{r:0,c:5}},{s:{r:3,c:3},e:{r:3,c:4}}];
ws.F2={t:'z',s:{patternType:'solid',fgColor:{rgb:'FF0000'}}};
const d=readPackages({Sheets:{'Багц 2026':ws}},'Багц 2026',2026);
assert.equal(d.contracts.length,3);assert.equal(d.contracts[0].total,2);assert.equal(d.contracts[0].remaining,1);
assert.equal(d.contracts[1].remaining,3);assert.equal(d.contracts[2].serviceId,7);
assert.deepEqual(d.redemptions.map(x=>x.date),['2026-01-02','2026-01-03']);
console.log('PASS: red excluded, blank rights, unused packages, real dates/years, repeated headers, note columns excluded');
const colored=XLSX.utils.aoa_to_sheet([
 ['ХАРИЛЦАГЧИЙН НЭР','Cryo Cabin 5',null,null,null,null,'Body therapy'],
 ['Customer',null,null,null,null,null,'1/5']
]);
colored['!merges']=[{s:{r:0,c:1},e:{r:0,c:5}}];
colored.B2={t:'z',s:{patternType:'solid',fgColor:{rgb:'FFFFFF'}}};
colored.C2={t:'z',s:{patternType:'solid',fgColor:{rgb:'CFE2F3'}}};
colored.D2={t:'z',s:{patternType:'solid',fgColor:{rgb:'B6D7A8'}}};
colored.E2={v:'1/1',s:{patternType:'solid',fgColor:{rgb:'EA9999'}}};
colored.F2={v:'1/2',s:{patternType:'solid',fgColor:{rgb:'CFE2F3'}}};
const checked=readPackages({Sheets:{'Багц 2026':colored}},'Багц 2026',2026);
assert.equal(checked.contracts[0].remaining,1);assert.equal(checked.contracts[0].total,2);
assert.equal(checked.contracts[1].total,1);assert.equal(checked.contracts[1].remaining,0);
assert.deepEqual(checked.redemptions.map(v=>v.date),['2026-01-02','2026-01-05']);
console.log('PASS white-only blanks, colored dated visits, red dates excluded, no phantom columns beyond sheet');
