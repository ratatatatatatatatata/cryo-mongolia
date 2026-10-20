import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import '../booking-time.js';
class Element {
 constructor(){this.children=[];this.dataset={};this.value='';this.disabled=false;this.hidden=false;}
 replaceChildren(){this.children=[];} append(...n){this.children.push(...n);} appendChild(n){this.children.push(n);}
 setAttribute(){} addEventListener(){} closest(){return this;} add(n){this.children.push(n);}
}
const fields={};const el=id=>fields[id]??=new Element();
el('bkScheduleDate').value='2099-01-01';el('bkNewRecipient').value='person';el('bkNewKind').value='standard';
let inserted,fail=false,seq=0;
const context=vm.createContext({console,Intl,Date,Set,CryoSchedule:globalThis.CryoSchedule,crypto:{randomUUID:()=>`test-${++seq}`},$:el,document:{createElement:()=>new Element()},Option:class{},
 alert:message=>{throw Error(message)},selectedSharedStaff:()=>({id:7,name:'Employee'}),isSharedStaffAccount:()=>true,isAdminUser:()=>true,renderOverview(){},fetchAll:async()=>({error:true}),
 sb:{from:table=>({select:()=>({is:()=>({order:async()=>({data:[{id:8,name:'Team'}]})})}),insert:rows=>{inserted=rows;return{select:async()=>fail?{error:{code:'23P01'}}:{data:rows.map((r,i)=>({...r,id:100+i}))}}}})}
});
const source=fs.readFileSync('admin.js','utf8');
vm.runInContext(`let bkDevice='1',bkSelectedSlots=[],bkTeams=[],me={};let cache={services:[{id:1,name:'Short',active:true,duration_minutes:3},{id:2,name:'Long',active:true,duration_minutes:60}],bookings:[]};function renderBookings(){renderBookingSchedule();}`,context);
vm.runInContext(source.slice(source.indexOf('function bookingDateToday()'),source.indexOf('function renderMessages()')),context);
vm.runInContext('renderBookingSchedule()',context);
el('bkScheduleSlots').children[0].onclick();el('bkScheduleSlots').children[1].onclick();
assert.equal(vm.runInContext('bkSelectedSlots.length',context),2);
el('bkDeviceTabs').children[2].onclick();el('bkScheduleSlots').children[0].onclick();
assert.equal(vm.runInContext('bkSelectedSlots.length',context),3);
el('bkScheduleDate').value='2099-01-02';vm.runInContext('renderBookingSchedule()',context);el('bkScheduleSlots').children[0].onclick();
assert.equal(vm.runInContext('bkSelectedSlots.length',context),4);
el('bkNewName').value='Customer';el('bkNewPhone').value='99999999';
await vm.runInContext('saveStaffBooking()',context);assert.equal(inserted.length,4);assert(inserted.every(r=>r.customer_name==='Customer'&&r.booking_group===inserted[0].booking_group));
assert.equal(vm.runInContext('bkSelectedSlots.length',context),0);
vm.runInContext("bkTeams=[{id:8,name:'Team'}];bkSelectedSlots=[{serviceId:1,startsAt:'2099-01-03T10:00:00+08:00',ref:'team-a'},{serviceId:1,startsAt:'2099-01-03T10:30:00+08:00',ref:'team-b'}]",context);
el('bkNewPhone').value='99999999';el('bkNewRecipient').value='team';el('bkNewTeam').value='8';fail=true;
await vm.runInContext('saveStaffBooking()',context);assert.equal(vm.runInContext('bkSelectedSlots.length',context),2);assert(el('bkNewStatus').textContent.includes('Аль ч цаг'));
fail=false;await vm.runInContext('saveStaffBooking()',context);assert(inserted.every(r=>r.team_id===8&&r.customer_name==='Баг: Team'));
console.log('PASS multi-slot selection across devices/dates, person/team assignment, atomic request, conflict retains selection');
