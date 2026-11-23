import assert from 'node:assert/strict';
import {calculateEntitlement} from '../package-customization.js';
import {assistantOperation} from '../staff-improvement-inbox.js';
assert.deepEqual(calculateEntitlement(4,'count',2),{base_units:4,bonus_mode:'count',bonus_value:2,bonus_units:2,units:6});
assert.equal(calculateEntitlement(4,'percent',50).units,6);
assert.equal(calculateEntitlement(0,'count',2).units,2);
for(const args of [['','count',0],[null,'count',0],[3,'percent',50],[4,'bad',2],[-1,'count',2],[4,'count',-1],[1000,'count',1],[0,'percent',50],[4,'count',Infinity]])assert.throws(()=>calculateEntitlement(...args));
assert.equal(assistantOperation('pay'),'payment');assert.equal(assistantOperation('book'),'booking');assert.equal(assistantOperation('some customer text'),'unknown');
console.log('PASS: entitlement counts/percent, unknown split, fractions, bounds, safe operation categories.');
