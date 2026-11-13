import assert from 'node:assert/strict';
import {bookingGroups,bookingUsage} from '../booking-groups.js';
const services=[{id:1,slug:'cryocabin',name:'Cabin',price:100000},{id:2,slug:'ledpro',name:'LED',price:60000}];
const rows=[{id:1,booking_group:'A',booked_date:'2026-11-03',customer_name:'Bat',phone:'99112233',service_id:1},{id:2,booking_group:'A',booked_date:'2026-11-03',customer_name:'Bat',phone:'99112233',service_id:2},{id:3,booking_group:'B',booked_date:'2026-11-03',customer_name:'Bat uvuu',phone:'9911 2233',service_id:2},{id:4,booking_group:'A',booked_date:'2026-11-04',customer_name:'Bat',phone:'99112233',service_id:2},{id:5,booking_group:'A',booked_date:'2026-11-03',customer_name:'Bat',phone:'88112233',service_id:2}];
const groups=bookingGroups(rows);assert.equal(groups.length,3);assert.equal(groups[0].length,3,'separately booked slots on the same day merge');
const usage=bookingUsage(groups[0],services);assert.equal(usage.total,220000);assert.equal(usage.counts.cryo_cabin,1);assert.equal(usage.counts.led_pro,2);assert.equal(usage.counts.x_cryo,0);assert.equal(usage.label,'Cabin ×1 + LED ×2');
assert.equal(bookingGroups([{id:7,booked_date:'2026-11-03',customer_name:'Saraa',phone:''},{id:8,booked_date:'2026-11-03',customer_name:' saraa ',phone:null}]).length,1,'no phone falls back to name');
console.log('PASS grouped appointments, separate people/orders, automatic counts and total');
