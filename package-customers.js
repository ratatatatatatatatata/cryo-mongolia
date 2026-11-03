const normalize=value=>String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('mn');
export function packageCustomerGroups(contracts,customers) {
  const byId=new Map(customers.map(c=>[String(c.id),c])),byName=new Map();
  for(const c of customers){const key=normalize(c.full_name);if(!byName.has(key))byName.set(key,[]);byName.get(key).push(c);}
  const groups=new Map();
  for(const contract of contracts){
    if(contract.status==='cancelled') continue;
    const name=normalize(contract.customer_label), candidates=byName.get(name)||[];
    const customer=byId.get(String(contract.customer_id)) || (candidates.length===1?candidates[0]:null);
    // Exact-name fallback for legacy workbook rows; never fuzzy-merge different people.
    const key=customer?`id:${customer.id}`:contract.customer_id?`id:${contract.customer_id}`:`legacy:${name}`;
    if(!groups.has(key))groups.set(key,{key,name:customer?.full_name||contract.customer_label||'Нэргүй',phone:customer?.phone||'',ambiguous:!customer&&candidates.length>1,contracts:[]});
    groups.get(key).contracts.push(contract);
  }
  return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'mn')||a.phone.localeCompare(b.phone));
}
export function packageState(contract,spent,today){
  if(contract.status==='completed')return 'completed';
  if(contract.status==='expired'||(contract.expires_on&&contract.expires_on<today))return 'expired';
  if(contract.total_units!=null&&spent>=Number(contract.total_units))return 'completed';
  return 'active';
}
