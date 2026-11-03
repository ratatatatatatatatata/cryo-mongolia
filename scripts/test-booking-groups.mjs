import assert from 'node:assert/strict';
import {bookingGroups,bookingUsage} from '../booking-groups.js';
const services=[{id:1,slug:'cryocabin',name:'Cabin',price:100000},{id:2,slug:'ledpro',name:'LED',price:60000}];
const rows=[{id:1,booking_group:'A',customer_name:'Bat',phone:'9911',service_id:1},{id:2,booking_group:'A',customer_name:'Bat',phone:'9911',service_id:2},{id:3,booking_group:'A',customer_name:'Bat',phone:'9911',service_id:2},{id:4,booking_group:'B',customer_name:'Bat',phone:'9911',service_id:2},{id:5,booking_group:'A',customer_name:'Bat',phone:'8811',service_id:2}];
const groups=bookingGroups(rows);assert.equal(groups.length,3);assert.equal(groups[0].length,3);
const usage=bookingUsage(groups[0],services);assert.equal(usage.total,220000);assert.equal(usage.counts.cryo_cabin,1);assert.equal(usage.counts.led_pro,2);assert.equal(usage.counts.x_cryo,0);assert.equal(usage.label,'Cabin ×1 + LED ×2');
console.log('PASS grouped appointments, separate people/orders, automatic counts and total');
