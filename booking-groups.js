export const deviceFields={cryocabin:'cryo_cabin',oxypro:'oxy_pro',ledpro:'led_pro',xcryo:'x_cryo',zerobody:'zerobody',normatec:'normatec',oxygen:'oxygen'};
const key=value=>String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('mn');
const digits=value=>String(value||'').replace(/\D/g,'').replace(/^976(?=\d{8}$)/,'');
// One row per customer (same name and phone; teams by team) per day — people who merely share a phone stay separate: slots booked in separate actions (or online) still check out together.
export function bookingGroups(rows){
 const groups=new Map();
 for(const row of rows){const k=JSON.stringify([row.booked_date||String(row.starts_at||'').slice(0,10)||`single:${row.id}`,row.team_id?`team:${row.team_id}`:`${key(row.customer_name)}|${digits(row.phone)}`]);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(row);}
 return [...groups.values()].map(group=>group.sort((a,b)=>String(a.starts_at||'').localeCompare(String(b.starts_at||''))||a.id-b.id));
}
export function bookingUsage(rows,services){
 const counts=Object.fromEntries(Object.values(deviceFields).map(key=>[key,0])),items=new Map();let total=0;
 for(const row of rows){const service=services.find(s=>Number(s.id)===Number(row.service_id));if(!service)continue;total+=Number(service.price||0);const field=deviceFields[service.slug];if(field)counts[field]++;const item=items.get(service.id)||{name:service.name,count:0};item.count++;items.set(service.id,item);}
 return {counts,total,label:[...items.values()].map(item=>`${item.name} ×${item.count}`).join(' + ')};
}
