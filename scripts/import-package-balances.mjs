// Packages-only reconciliation. No sales, attendance or payroll changes.
// npm install --no-save xlsx@0.18.5
// node scripts/import-package-balances.mjs source.xlsx
// SQL and source records stay in gitignored supabase/local/.
import XLSX from 'xlsx';
import fs from 'node:fs';
import {readPackages} from './package-workbook.mjs';
const file=process.argv[2];if(!file)throw Error('Provide source workbook.xlsx');
const wb=XLSX.readFile(file,{cellStyles:true,cellNF:true,sheetStubs:true});
const contracts=[],redemptions=[],warnings=[];
const sheets=wb.SheetNames.filter(s=>/^Багц \d{4}$/.test(s));
for(const sheet of sheets){const d=readPackages(wb,sheet,+sheet.slice(-4));contracts.push(...d.contracts);redemptions.push(...d.redemptions);warnings.push(...d.warnings);}
if(!contracts.length)throw Error('No package data; refusing import');
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
const sql=`begin;
lock table public.customer_package_contracts, public.package_redemptions in share row exclusive mode;
create temporary table incoming_contracts on commit drop as select * from jsonb_to_recordset(${quote(JSON.stringify(contracts))}::jsonb) as x(key text,customer text,label text,start date,total int,remaining int,status text,notes text,"serviceId" bigint);
create temporary table incoming_visits on commit drop as select * from jsonb_to_recordset(${quote(JSON.stringify(redemptions))}::jsonb) as x("contractKey" text,date date,key text,"serviceId" bigint,label text);
create temporary table manual_before on commit drop as select * from public.package_redemptions where source_key is null or source_key !~ '^Багц [0-9]{4}:';
-- Stable contract IDs preserve all employee-recorded visits and references.
update public.customer_package_contracts c set customer_label=i.customer,package_label=i.label,purchased_on=i.start,total_units=i.total,notes=i.notes,
 service_units=jsonb_build_array(jsonb_build_object('service_id',i."serviceId",'service_name',s.name,'units',i.total))
from incoming_contracts i join public.services s on s.id=i."serviceId" where c.source_key=i.key;
insert into public.customer_package_contracts(customer_label,package_label,purchased_on,total_units,status,source_key,notes,service_units)
select i.customer,i.label,i.start,i.total,i.status,i.key,i.notes,jsonb_build_array(jsonb_build_object('service_id',i."serviceId",'service_name',s.name,'units',i.total))
from incoming_contracts i join public.services s on s.id=i."serviceId" where not exists(select 1 from public.customer_package_contracts c where c.source_key=i.key);
-- Refresh only cells from the imported sheets; manual entries remain untouched.
delete from public.package_redemptions where split_part(source_key,':',1) in (${sheets.map(quote).join(',')});
insert into public.package_redemptions(contract_id,used_on,units,source_key,service_id,service_label)
select c.id,i.date,1,i.key,i."serviceId",s.name from incoming_visits i join public.customer_package_contracts c on c.source_key=i."contractKey" join public.services s on s.id=i."serviceId";
update public.customer_package_contracts c set status=case when c.total_units>(select coalesce(sum(r.units),0) from public.package_redemptions r where r.contract_id=c.id) then 'active' else 'completed' end
where c.source_key in(select key from incoming_contracts) and c.status not in('cancelled','expired');
-- Obsolete workbook-only records are retained as cancelled, never hard-deleted.
update public.customer_package_contracts c set status='cancelled' where split_part(c.source_key,':',1) in (${sheets.map(quote).join(',')}) and not exists(select 1 from incoming_contracts i where i.key=c.source_key);
do $$ begin
 if exists((select * from manual_before except select * from public.package_redemptions) union all (select * from public.package_redemptions where source_key is null or source_key !~ '^Багц [0-9]{4}:' except select * from manual_before)) then raise exception 'Manual visits changed'; end if;
 if (select count(*) from incoming_visits)<>(select count(*) from public.package_redemptions where source_key in(select key from incoming_visits)) then raise exception 'Visit count mismatch'; end if;
end $$;
select jsonb_build_object('contracts',(select count(*) from incoming_contracts),'dated_visits',(select count(*) from incoming_visits),'source_remaining',(select sum(remaining) from incoming_contracts),'manual_preserved',(select count(*) from manual_before)) as result;
commit;
`;
fs.mkdirSync('supabase/local',{recursive:true});
fs.writeFileSync('supabase/local/import-package-balances.sql',sql);
fs.writeFileSync('supabase/local/package-import-review.json',JSON.stringify({contracts,redemptions,warnings},null,2));
console.log(JSON.stringify({contracts:contracts.length,datedVisits:redemptions.length,remaining:contracts.reduce((s,c)=>s+c.remaining,0),notesExcluded:warnings.length,sqlBytes:Buffer.byteLength(sql)}));
