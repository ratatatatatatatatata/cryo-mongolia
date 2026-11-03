const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const fields={};const el=id=>fields[id]??={value:'',textContent:'',style:{},classList:{add(){},remove(){},contains(){return false}},setAttribute(){},replaceChildren(){},append(){}};
let saved,calls=0;
const context=vm.createContext({console,Date,Number,crypto:require('node:crypto').webcrypto,setTimeout,clearInterval,setInterval,
 document:{getElementById:el,querySelectorAll:()=>[],createElement:()=>({setAttribute(){},append(){}})},
 window:{cryoAuth:{user:{id:'customer'}},cryoData:{ready:true,saveBookings:async rows=>{saved=rows;calls++;return{data:rows}}}},
 setText:(id,text)=>el(id).textContent=text,showToast:m=>{throw Error(m)},shakeInput:id=>{throw Error(id)},slotIso:(day,time)=>`${day}T${time}:00+08:00`,refreshAvailability:async()=>{}});
vm.runInContext("let bk={service:{id:1,name:'Cryo',price:100000,duration_minutes:3},dateKey:'2099-01-01',time:'',selections:[]};let qrInterval=null;function activeService(){return bk.service;}function buildTimeGrid(){}",context);
const source=fs.readFileSync('index.js','utf8');vm.runInContext(source.slice(source.indexOf('function pickTime('),source.indexOf('function openModal()')),context);
vm.runInContext("pickTime('10:00',{classList:{add(){}}});bk.service={id:2,name:'LED',price:75000,duration_minutes:15};pickTime('11:00',{classList:{add(){}}});",context);
assert.equal(vm.runInContext('bk.selections.length',context),2);assert.equal(vm.runInContext('bookingTotal()',context),175000);
el('b_name').value='Customer';el('b_phone').value='99112233';
vm.runInContext('goStep2()',context);assert.match(el('sum_deposit').textContent,/175,000/);
(async()=>{await vm.runInContext('showQR()',context);assert.equal(calls,1);assert.equal(saved.length,2);assert.equal(saved[0].booking_group,saved[1].booking_group);assert(saved.every(r=>r.status==='pending'&&r.deposit===0));assert.equal(saved.reduce((s,r)=>s+r.amount,0),175000);await vm.runInContext('showQR()',context);assert.equal(calls,1);assert(!source.includes('}, 6000)'));console.log('PASS public multi-service selection, combined total, single submission, pending payment, retry guard');})().catch(e=>{console.error(e);process.exit(1)});
