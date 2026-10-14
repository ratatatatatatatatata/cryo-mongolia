const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('admin.js','utf8');
function extract(name){const start=source.indexOf('function '+name+'(');const end=source.indexOf('\nfunction ',start+1);return source.slice(start,end<0?undefined:end);}
const host={innerHTML:''};
const rows=[{id:1,staff_id:5,work_date:'2026-10-14',clock_in:'2026-10-14T01:00:00Z',clock_out:'2026-10-14T03:00:00Z'},{id:2,staff_id:5,work_date:'2026-10-14',clock_in:'2026-10-14T04:00:00Z',clock_out:'2026-10-14T05:00:00Z'}];
const ctx=vm.createContext({cache:{attendance:rows},$:()=>host,Date,Map,Number,String,Math});
for(const name of ['currentAttendanceSession','attendanceMinutes','formatMinutes','renderAttendanceKpis'])vm.runInContext(extract(name),ctx);
assert.equal(vm.runInContext("currentAttendanceSession(5,'2026-10-14').id",ctx),2);
vm.runInContext('renderAttendanceKpis(cache.attendance)',ctx);assert.match(host.innerHTML,/3ц 0м/);assert.match(host.innerHTML,/Бүртгэлтэй хүн<\/div><div class="kpi-value">1/);
rows.push({id:3,staff_id:5,work_date:'2026-10-14',clock_in:'2026-10-14T06:00:00Z',clock_out:null});
assert.equal(vm.runInContext("currentAttendanceSession(5,'2026-10-14').id",ctx),3);
vm.runInContext('renderAttendanceKpis(cache.attendance)',ctx);assert.match(host.innerHTML,/Ээлжтэй<\/div><div class="kpi-value">1/);assert.match(host.innerHTML,/Гарсан<\/div><div class="kpi-value">0/);
console.log('Latest active session, distinct employee counts and summed worked time verified');
