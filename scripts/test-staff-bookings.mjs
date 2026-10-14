import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import '../booking-time.js';

class Element {
  constructor() { this.children=[]; this.dataset={}; this.value=''; this.disabled=false; this.hidden=false; this.textContent=''; }
  replaceChildren() { this.children=[]; }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.children.push(node); }
  setAttribute() {}
  addEventListener() {}
  focus() {}
}
const ids=['bkFromDate','bkToDate','bkDeviceTabs','bkScheduleDate','bkScheduleSlots','bkNewCancel','bkNewSave','bkNewForm','bkNewTitle','bkNewName','bkNewPhone','bkNewKind','bkNewNote','bkNewStatus','bkScheduleHint'];
const fields=Object.fromEntries(ids.map(id=>[id,new Element()]));
fields.bkScheduleDate.value='2099-01-01';
let inserted;
const context=vm.createContext({
  console, Intl, Date, CryoSchedule:globalThis.CryoSchedule, crypto:{randomUUID:()=> 'test-id'},
  $:id=>fields[id], document:{createElement:()=>new Element()},
  alert:message=>{throw new Error(message);},
  selectedSharedStaff:()=>({id:7,name:'Test employee'}), isSharedStaffAccount:()=>true,
  renderOverview(){},
  sb:{from:table=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null})})}),insert:row=>{assert.equal(table,'bookings');inserted=row;return{select:()=>({single:async()=>({data:{id:9,...row,booked_date:'2099-01-01',blocked_until:'2099-01-01T10:00:00+08:00'},error:null})})};}})},
});
const source=fs.readFileSync(new URL('../admin.js',import.meta.url),'utf8');
vm.runInContext(`let bkDevice='1',bkSelectedSlot=null,me={};let cache={services:[{id:1,name:'Short',active:true,duration_minutes:3},{id:2,name:'Long',active:true,duration_minutes:60}],bookings:[{id:1,service_id:1,customer_name:'Reserved',status:'confirmed',starts_at:'2099-01-01T09:00:00+08:00',blocked_until:'2099-01-01T09:30:00+08:00'}]};function renderBookings(){renderBookingSchedule();}`,context);
vm.runInContext(source.slice(source.indexOf('function bookingDateToday()'),source.indexOf('function renderMessages()')),context);
vm.runInContext('renderBookingSchedule()',context);
assert.equal(fields.bkDeviceTabs.children.length,3);
assert.equal(fields.bkScheduleSlots.children[0].disabled,true);
assert.equal(fields.bkScheduleSlots.children[1].disabled,false);
fields.bkScheduleSlots.children[1].onclick();
assert.equal(fields.bkNewForm.hidden,false);
fields.bkNewName.value='Test customer';fields.bkNewPhone.value='99000000';fields.bkNewKind.value='standard';
await vm.runInContext('saveStaffBooking()',context);
assert.equal(inserted.service_id,1);
assert.equal(inserted.starts_at,'2099-01-01T09:30:00+08:00');
assert.equal(inserted.status,'confirmed');
assert.equal(inserted.amount,0);
assert.equal(fields.bkNewForm.hidden,true);
assert.equal(fields.bkNewSave.disabled,false);
fields.bkDeviceTabs.children[2].onclick();
assert.match(fields.bkScheduleHint.textContent,/Long/);
assert.equal(vm.runInContext('bkDevice',context),'2');
console.log('12 staff device schedule and save checks passed (mock database)');
