export const deviceFields={cryocabin:'cryo_cabin',oxypro:'oxy_pro',ledpro:'led_pro',xcryo:'x_cryo',zerobody:'zerobody',normatec:'normatec',oxygen:'oxygen'};
export function bookingGroups(rows){
 const groups=new Map();
 for(const row of rows){const key=JSON.stringify([row.booking_group||`single:${row.id}`,row.customer_name,row.phone||'',row.user_id||'',row.team_id||'']);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
 return [...groups.values()];
}
export function bookingUsage(rows,services){
 const counts=Object.fromEntries(Object.values(deviceFields).map(key=>[key,0])),items=new Map();let total=0;
 for(const row of rows){const service=services.find(s=>Number(s.id)===Number(row.service_id));if(!service)continue;total+=Number(service.price||0);const field=deviceFields[service.slug];if(field)counts[field]++;const item=items.get(service.id)||{name:service.name,count:0};item.count++;items.set(service.id,item);}
 return {counts,total,label:[...items.values()].map(item=>`${item.name} ×${item.count}`).join(' + ')};
}
