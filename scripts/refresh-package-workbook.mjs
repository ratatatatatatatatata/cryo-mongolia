// Refresh only package data from a current workbook; preserve manual visits and stable customer contracts.
import fs from 'node:fs';
import XLSX from 'xlsx';
import {readPackages} from './package-workbook.mjs';
const wb=XLSX.readFile(process.argv[2],{cellStyles:true,cellNF:true,sheetStubs:true});
const contracts=[],visits=[];
for(const sheet of wb.SheetNames.filter(s=>/^Багц \d{4}$/.test(s))){const d=readPackages(wb,sheet,+sheet.slice(-4));contracts.push(...d.contracts);visits.push(...d.redemptions);}
if(!contracts.length||!visits.length)throw Error('No package data');
const q=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
const sql=`begin;
lock table public.customer_package_contracts,public.package_redemptions in share row exclusive mode;
create temporary table incoming on commit drop as select * from jsonb_to_recordset(${q(contracts)}) as x(key text,customer text,label text,start date,total int,remaining int,status text,notes text,"serviceId" bigint);
create temporary table incoming_visits on commit drop as select * from jsonb_to_recordset(${q(visits)}) as x("contractKey" text,date date,key text,"serviceId" bigint,label text);
create temporary table old_contracts on commit drop as select * from public.customer_package_contracts where source_key ~ '^Багц [0-9]{4}:';
create temporary table manual_before on commit drop as select * from public.package_redemptions where source_key is null or source_key !~ '^Багц [0-9]{4}:';
create temporary table candidates on commit drop as
select i.key,c.id,case when c.source_key=i.key then 0 else 1 end as priority
from incoming i join old_contracts c on c.package_label=i.label
and (c.customer_label=i.customer or (c.source_key=i.key and starts_with(i.customer,c.customer_label||' ')))
and (c.source_key=i.key or c.purchased_on is not distinct from i.start);
create temporary table mapping on commit drop as
select key,min(id) as id from candidates a where priority=(select min(priority) from candidates b where b.key=a.key) group by key having count(*)=1;
do $$ begin
 if exists(select id from mapping group by id having count(*)>1) then raise exception 'Ambiguous contract identity'; end if;
 if exists(select 1 from manual_before m join old_contracts c on c.id=m.contract_id where not exists(select 1 from mapping x where x.id=c.id)) then raise exception 'Manual contract cannot be matched safely'; end if;
end $$;
-- Vacate row-derived keys before remapping moved rows; historical IDs remain stable.
update public.customer_package_contracts c set source_key='workbook-retired:'||c.id||':'||c.source_key,status='cancelled' from old_contracts o where o.id=c.id;
update public.customer_package_contracts c set source_key=i.key,customer_label=i.customer,package_label=i.label,purchased_on=i.start,total_units=i.total,notes=i.notes,service_units='[]'::jsonb,status=i.status
from incoming i join mapping m on m.key=i.key where c.id=m.id;
insert into public.customer_package_contracts(customer_label,package_label,purchased_on,total_units,status,source_key,notes)
select customer,label,start,total,status,key,notes from incoming i where not exists(select 1 from mapping m where m.key=i.key);
delete from public.package_redemptions where source_key ~ '^Багц [0-9]{4}:';
insert into public.package_redemptions(contract_id,used_on,units,source_key,service_id,service_label)
select c.id,v.date,1,v.key,v."serviceId",s.name from incoming_visits v join public.customer_package_contracts c on c.source_key=v."contractKey" join public.services s on s.id=v."serviceId";
update public.customer_package_contracts c set service_units=jsonb_build_array(jsonb_build_object('service_id',i."serviceId",'service_name',s.name,'units',i.total)),
status=case when i.total>(select coalesce(sum(units),0) from public.package_redemptions where contract_id=c.id) then 'active' else 'completed' end
from incoming i join public.services s on s.id=i."serviceId" where c.source_key=i.key;
do $$ begin
 if exists((select * from manual_before except select * from public.package_redemptions) union all (select * from public.package_redemptions where source_key is null or source_key !~ '^Багц [0-9]{4}:' except select * from manual_before)) then raise exception 'Manual visits changed'; end if;
 if (select count(*) from incoming_visits)<>(select count(*) from public.package_redemptions where source_key ~ '^Багц [0-9]{4}:') then raise exception 'Visit count mismatch'; end if;
 if exists(select 1 from incoming i left join public.customer_package_contracts c on c.source_key=i.key where c.id is null or c.total_units<>i.total or c.customer_label<>i.customer) then raise exception 'Contract mismatch'; end if;
end $$;
select jsonb_build_object('contracts',(select count(*) from incoming),'dated_visits',(select count(*) from incoming_visits),'source_remaining',(select sum(remaining) from incoming),'manual_preserved',(select count(*) from manual_before),'retained_ids',(select count(*) from mapping)) result;
commit;`;
fs.mkdirSync('supabase/local',{recursive:true});fs.writeFileSync('supabase/local/refresh-package-workbook.sql',sql);
console.log(JSON.stringify({contracts:contracts.length,visits:visits.length,remaining:contracts.reduce((n,c)=>n+c.remaining,0)}));
