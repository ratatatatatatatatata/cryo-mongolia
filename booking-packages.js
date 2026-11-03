const norm=value=>String(value||'').trim().replace(/\s+/g,' ').toLowerCase();
export function previousCustomers(customers,bookings,sales){
 const rows=new Map();for(const c of customers)rows.set(`${norm(c.full_name)}|${norm(c.phone)}`,{...c});
 for(const b of [...bookings,...sales]){if(!b.customer_name||!b.phone||b.team_id)continue;const key=`${norm(b.customer_name)}|${norm(b.phone)}`;if(!rows.has(key))rows.set(key,{full_name:b.customer_name,phone:b.phone});}
 return [...rows.values()];
}
export function packageOptions(contracts,redemptions,customers,name,phone,serviceId,date){
 const people=customers.filter(c=>norm(c.full_name)===norm(name));
 return contracts.filter(c=>{
  if(c.status!=='active'||(c.expires_on&&date>c.expires_on)||(c.purchased_on&&date<c.purchased_on))return false;
  if(c.customer_id){const owner=customers.find(p=>Number(p.id)===Number(c.customer_id));if(!owner||norm(owner.full_name)!==norm(name)||norm(owner.phone)!==norm(phone))return false;}
  else if(norm(c.customer_label)!==norm(name)||people.length>1||(people.length===1&&people[0].phone&&norm(people[0].phone)!==norm(phone)))return false;
  return (c.service_units||[]).some(i=>Number(i.service_id)===Number(serviceId));
 }).map(c=>{const allowance=Number(c.service_units.find(i=>Number(i.service_id)===Number(serviceId)).units);const spent=redemptions.filter(r=>Number(r.contract_id)===Number(c.id)&&Number(r.service_id)===Number(serviceId)).reduce((n,r)=>n+Number(r.units||0),0);const all=redemptions.filter(r=>Number(r.contract_id)===Number(c.id)).reduce((n,r)=>n+Number(r.units||0),0);return {contract:c,remaining:Math.min(allowance-spent,c.total_units==null?Infinity:Number(c.total_units)-all)};}).filter(c=>c.remaining>0);
}
