// Correct only workbook-derived limits. Never replace employee-recorded visits.
// Produces reviewable SQL under ignored supabase/local; execute once after review.
import XLSX from 'xlsx';
import fs from 'node:fs';
import {readPackages} from './package-workbook.mjs';
const wb=XLSX.readFile(process.argv[2],{cellStyles:true,cellNF:true,sheetStubs:true});
const contracts=[],visits=[];
for(const sheet of wb.SheetNames.filter(s=>/^Багц \d{4}$/.test(s))) {
 const d=readPackages(wb,sheet,+sheet.slice(-4));
 contracts.push(...d.contracts.map(c=>({key:c.key,total:c.total,remaining:c.remaining,service_id:c.serviceId})));
 visits.push(...d.redemptions.map(v=>({key:v.key,date:v.date})));
}
if(!contracts.length||!visits.length)throw Error('Empty workbook');
const quote=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
const sql=`begin;
lock table public.customer_package_contracts,public.package_redemptions in share row exclusive mode;
create temporary table incoming_limits on commit drop as select * from jsonb_to_recordset(${quote(contracts)}) as x(key text,total int,remaining int,service_id bigint);
create temporary table expected_visits on commit drop as select * from jsonb_to_recordset(${quote(visits)}) as x(key text,date date);
create temporary table visits_before on commit drop as select * from public.package_redemptions;
do $$ begin
 if exists(select 1 from incoming_limits i left join public.customer_package_contracts c on c.source_key=i.key where c.id is null) then raise exception 'Missing source contract'; end if;
 if exists(select key,date from expected_visits except select source_key,used_on from public.package_redemptions) or exists(select source_key,used_on from public.package_redemptions where source_key ~ '^Багц [0-9]{4}:' except select key,date from expected_visits) then raise exception 'Workbook dates changed; reconcile visits separately'; end if;
end $$;
update public.customer_package_contracts c set total_units=i.total,
 service_units=jsonb_build_array(jsonb_build_object('service_id',i.service_id,'service_name',s.name,'units',i.total)),
 status=case when c.status in ('expired','cancelled') then c.status when i.total>(select coalesce(sum(units),0) from public.package_redemptions where contract_id=c.id) then 'active' else 'completed' end
from incoming_limits i join public.services s on s.id=i.service_id where c.source_key=i.key;
update public.customer_package_contracts c set status='cancelled'
where c.source_key ~ '^Багц [0-9]{4}:' and not exists(select 1 from incoming_limits i where i.key=c.source_key);
do $$ begin
 if exists((select * from visits_before except select * from public.package_redemptions) union all (select * from public.package_redemptions except select * from visits_before)) then raise exception 'Visits changed'; end if;
 if exists(select 1 from incoming_limits i join public.customer_package_contracts c on c.source_key=i.key where c.total_units<>i.total or (c.service_units->0->>'units')::int<>i.total) then raise exception 'Limit mismatch'; end if;
end $$;
select jsonb_build_object('contracts',(select count(*) from incoming_limits),'dated_visits',(select count(*) from expected_visits),'white_remaining',(select sum(remaining) from incoming_limits),'visits_unchanged',true) as result;
commit;`;
fs.mkdirSync('supabase/local',{recursive:true});
fs.writeFileSync('supabase/local/reconcile-package-balances.sql',sql);
console.log(JSON.stringify({contracts:contracts.length,datedVisits:visits.length,remaining:contracts.reduce((n,c)=>n+c.remaining,0)}));
