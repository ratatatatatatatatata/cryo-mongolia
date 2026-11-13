const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const src=fs.readFileSync('admin.js','utf8'),html=fs.readFileSync('admin.html','utf8');
const fields={};const el=id=>fields[id]??=( {value:'',checked:false,disabled:false,style:{},selectedOptions:[{dataset:{staffId:'7'}}],textContent:''});
let calls=0,saved,view,alerts=[];
const context=vm.createContext({console,Number,CustomEvent:class{constructor(type,args){this.detail=args.detail;}},$:el,
 alert:m=>alerts.push(m),isAdminUser:()=>false,renderBookings(){},renderReports(){},renderLedger(){},paymentGroup:b=>[b],switchView:v=>view=v,setBookingCheckoutMode(){},refreshCustomers(){},normalizePhone:v=>String(v||'').replace(/\D/g,''),ensureCustomer:async()=>({}),
 applyCheckoutResult:d=>context.window.dispatchEvent({detail:d.sale}),
 window:{dispatchEvent:e=>saved=e.detail},sb:{rpc:async(name,args)=>{calls++;assert.equal(name,'pay_bookings');assert.equal(JSON.stringify(args.p_booking_ids),"[1]");assert(!('sale_date' in args.p_sale),'staff cannot backdate');return{data:{booking:{id:1,payment_status:'paid'},sale:{id:2,cash:50000}}};}}});
vm.runInContext("let paymentBooking={id:1,payment_status:'pending'},paymentRows=[{id:1}],giftCardChoices=[],ledEditing=null,cache={sales:[]};const PAYS=[['cash','','f_cash'],['golomt','','f_golomt'],['khan','','f_khan'],['barter','','f_barter'],['gift_card','','f_gift'],['internal_amount','','f_internal_amount']];const DEVICES=[];",context);
vm.runInContext(src.slice(src.indexOf('async function saveLedger()'),src.indexOf('function renderLedger()')),context);
(async()=>{
 el('f_date').value='2026-10-20';el('f_name').value='Customer';el('f_phone').value='99112233';el('f_svc').value='Service';
 await vm.runInContext('saveLedger()',context);assert.equal(calls,0);assert.equal(alerts.length,1);
 el('f_cash').value=50000;el('ledSave').disabled=true;
 await vm.runInContext('saveLedger()',context);assert.equal(calls,0);
 el('ledSave').disabled=false;
 await vm.runInContext('saveLedger()',context);assert.equal(calls,1);assert.equal(saved.id,2);assert.equal(view,'reports');assert.equal(el('ledForm').style.display,'none');
 const report=html.slice(html.indexOf('data-panel="reports"'),html.indexOf('data-panel="ledger"'));
 assert(!report.includes('id="repPackageSales"'));assert(html.slice(html.indexOf('data-panel="packages"')).includes('id="repPackageSales"'));
 assert(html.includes('<th>Төлөв</th><th>Төлөлт</th>'));assert(html.includes('id="bookingPaymentHost"'));
 console.log('PASS payment validation, duplicate-click guard, save/redirect, package button location, payment column');
})().catch(e=>{console.error(e);process.exit(1)});
