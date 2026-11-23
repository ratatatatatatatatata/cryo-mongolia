-- Additive APIs. No historical customer, payment, redemption or template is
-- rewritten by applying this migration. Customization needs an explicit save.
create function private.customer_package_editor(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 c public.customer_package_contracts%rowtype; before_state jsonb;
 prior public.package_account_events%rowtype; req uuid; fingerprint text;
 history jsonb; token text; result jsonb; items jsonb:='[]'; item jsonb;
 svc public.services%rowtype; base numeric; bonus numeric; value numeric;
 mode text; total integer:=0; spent integer; expiry date; label text;
 employee bigint:=nullif(p->>'staff_id','')::bigint;
begin
 perform private.require_cryo_staff(employee);
 if p->>'action' is null or p->>'action' not in ('read','save') then raise exception 'Үйлдэл буруу'; end if;
 if p->>'action'='save' then
  if p - array['action','request_id','staff_id','contract_id','expected_token','package_label','expires_on','items','reason'] <> '{}'::jsonb then raise exception 'Зөвшөөрөөгүй талбар байна'; end if;
  req:=(p->>'request_id')::uuid;
  if req is null then raise exception 'Бүртгэлийн дугаар шаардлагатай'; end if;
  fingerprint:=md5(p::text);
  perform pg_advisory_xact_lock(hashtextextended(req::text,0));
  select * into prior from public.package_account_events where request_id=req;
  if found then
   if prior.created_by<>auth.uid() or prior.action<>'custom_edit' or prior.detail->>'request_hash' is distinct from fingerprint then raise exception 'Хүсэлтийн дугаар давхардсан' using errcode='42501'; end if;
   return prior.detail;
  end if;
 end if;
 -- Redemptions already lock this contract in check_package_service_units.
 select * into c from public.customer_package_contracts where id=(p->>'contract_id')::bigint for update;
 if not found then raise exception 'Багц олдсонгүй'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'service_id',service_id,'units',units,'used_on',used_on) order by id),'[]'::jsonb)
 into history from public.package_redemptions where contract_id=c.id;
 token:=md5(to_jsonb(c)::text||history::text);
 if p->>'action'='read' then
  return jsonb_build_object('contract',to_jsonb(c),'history',history,'token',token);
 end if;
 if p->>'expected_token' is distinct from token then raise exception 'Багц эсвэл ашиглалт өөрчлөгдсөн байна. Дахин нээгээд шинэ мэдээллийг шалгана уу.' using errcode='40001'; end if;
 if c.status='cancelled' then raise exception 'Цуцалсан багцыг энэ үйлдлээр сэргээхгүй'; end if;
 if length(trim(coalesce(p->>'reason',''))) not between 5 and 500 then raise exception 'Өөрчлөх шалтгааныг 5–500 тэмдэгтээр оруулна уу'; end if;
 label:=trim(p->>'package_label'); expiry:=nullif(p->>'expires_on','')::date;
 if label is null or length(label) not between 1 and 120 then raise exception 'Багцын нэр оруулна уу'; end if;
 if expiry is not null and (expiry<c.purchased_on or extract(year from expiry)>2100) then raise exception 'Дуусах огноо буруу'; end if;
 if jsonb_typeof(p->'items') is distinct from 'array' then raise exception 'Үйлчилгээгээ оруулна уу'; end if;
 if jsonb_array_length(p->'items') not between 1 and 100 then raise exception '1–100 үйлчилгээ сонгоно уу'; end if;
 if exists(select 1 from jsonb_array_elements(history) h where h->>'service_id' is null) then raise exception 'Үйлчилгээ нь тодорхойгүй хуучин ашиглалт байна. Админаар эхлээд тулгуулна уу'; end if;
 for item in select x.value from jsonb_array_elements(p->'items') x loop
  if item->>'base_units' is null or item->>'bonus_value' is null then raise exception 'Үндсэн ба урамшууллын задаргааг баталгаажуулна уу'; end if;
  base:=(item->>'base_units')::numeric; value:=(item->>'bonus_value')::numeric; mode:=item->>'bonus_mode';
  if base not between 0 and 1000 or base<>trunc(base) or value not between 0 and 1000 or value<>round(value,2) or mode is null or mode not in ('count','percent') then raise exception 'Үндсэн тоо, урамшууллаа зөв оруулна уу'; end if;
  bonus:=case when mode='percent' then base*value/100 else value end;
  if bonus<>trunc(bonus) or base+bonus not between 1 and 1000 then raise exception 'Нийт оролт 1–1000 бүхэл тоо байна. Бутархай урамшууллыг тоогоор оруулна уу'; end if;
  select * into svc from public.services where id=(item->>'service_id')::bigint;
  if not found or (not coalesce(svc.active,false) and not exists(select 1 from jsonb_array_elements(c.service_units) old where old->>'service_id'=item->>'service_id')) then raise exception 'Үйлчилгээ олдсонгүй эсвэл идэвхгүй'; end if;
  if exists(select 1 from jsonb_array_elements(items) x where (x->>'service_id')::bigint=svc.id) then raise exception 'Үйлчилгээ давхардсан'; end if;
  items:=items||jsonb_build_array(jsonb_build_object('service_id',svc.id,'service_name',svc.name,'base_units',base::int,'bonus_mode',mode,'bonus_value',value,'bonus_units',bonus::int,'units',(base+bonus)::int));
  total:=total+(base+bonus)::int;
 end loop;
 -- Keep existing service rows and all consumed units: no silent removal.
 if exists(select 1 from jsonb_array_elements(c.service_units) old where not exists(select 1 from jsonb_array_elements(items) x where x->>'service_id'=old->>'service_id')) then raise exception 'Өмнөх үйлчилгээг хасахгүй. Тоог нь ашиглалтаас багагүйгээр засна уу'; end if;
 if exists(select 1 from public.package_redemptions r where r.contract_id=c.id group by r.service_id having sum(r.units)>coalesce((select (x->>'units')::int from jsonb_array_elements(items) x where (x->>'service_id')::bigint=r.service_id),0)) then raise exception 'Нийт эрх ашигласан оролтоос бага байж болохгүй'; end if;
 select coalesce(sum(units),0) into spent from public.package_redemptions where contract_id=c.id;
 before_state:=to_jsonb(c);
 update public.customer_package_contracts set package_label=label,expires_on=expiry,service_units=items,total_units=total,
  status=case when expiry<(now() at time zone 'Asia/Ulaanbaatar')::date then 'expired' when spent>=total then 'completed' else 'active' end
 where id=c.id returning * into c;
 result:=jsonb_build_object('contract',to_jsonb(c),'before',before_state,'note',trim(p->>'reason'),'staff_id',employee,'request_hash',fingerprint);
 insert into public.package_account_events(request_id,contract_id,action,detail,created_by) values(req,c.id,'custom_edit',result,auth.uid());
 return result;
end $$;
revoke all on function private.customer_package_editor(jsonb) from public,anon;
grant execute on function private.customer_package_editor(jsonb) to authenticated;
create function public.customer_package_editor(p jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.customer_package_editor(p)$$;
revoke all on function public.customer_package_editor(jsonb) from public,anon;
grant execute on function public.customer_package_editor(jsonb) to authenticated;

-- Staff requests are private to this ERP. No raw assistant prompt, customer
-- record, phone, token or stack trace is captured automatically.
create table public.staff_improvement_requests (
 id bigint generated always as identity primary key,
 request_id uuid not null unique,
 created_by uuid not null references auth.users(id),
 staff_id bigint references public.staff(id),
 category text not null check(category in ('unsupported','save_failed','suggestion')),
 operation text not null check(operation in ('unknown','booking','payment','package','gift','team','attendance','customer','other')),
 summary text not null check(length(summary) between 5 and 600),
 status text not null default 'new' check(status in ('new','in_review','needs_info','planned','done')),
 admin_note text not null default '' check(length(admin_note)<=600),
 occurrences integer not null default 1,
 revision integer not null default 1,
 updates jsonb not null default '[]',
 created_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now()
);
alter table public.staff_improvement_requests enable row level security;
-- Access only through the authenticated, role-checked APIs below.
create index staff_requests_owner_idx on public.staff_improvement_requests(created_by,staff_id,last_seen_at desc);
create index staff_requests_status_idx on public.staff_improvement_requests(status,last_seen_at desc);

create function private.staff_improvement_inbox(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a text:=p->>'action'; employee bigint:=nullif(p->>'staff_id','')::bigint;
 r public.staff_improvement_requests%rowtype; req uuid; category text; operation text; summary text; result jsonb;
begin
 perform private.require_cryo_staff(employee);
 if a='list' then
  select coalesce(jsonb_agg(to_jsonb(x) order by x.last_seen_at desc),'[]') into result from (
   select t.*,s.name as staff_name from public.staff_improvement_requests t left join public.staff s on s.id=t.staff_id
   where public.is_admin() or (t.created_by=auth.uid() and (not public.is_shared_staff_account() or t.staff_id=employee))
   order by t.last_seen_at desc limit 100
  ) x;
  return jsonb_build_object('requests',result,'is_admin',public.is_admin(),'open_count',(select count(*) from public.staff_improvement_requests t where t.status<>'done' and (public.is_admin() or (t.created_by=auth.uid() and (not public.is_shared_staff_account() or t.staff_id=employee)))));
 elsif a='report' then
  req:=(p->>'request_id')::uuid; category:=p->>'category'; operation:=p->>'operation';
  if req is null or category is null or category not in ('unsupported','save_failed','suggestion') or operation is null or operation not in ('unknown','booking','payment','package','gift','team','attendance','customer','other') then raise exception 'Хүсэлтийн төрөл буруу'; end if;
  -- Serialize all submissions by this login to enforce rate limit + dedupe.
  perform pg_advisory_xact_lock(hashtextextended('staff-request:'||auth.uid()::text,0));
  select * into r from public.staff_improvement_requests where request_id=req;
  if found then
   if r.created_by<>auth.uid() or r.staff_id is distinct from employee or r.category<>category or r.operation<>operation then raise exception 'Хүсэлтийн дугаар давхардсан' using errcode='42501'; end if;
   return jsonb_build_object('request',to_jsonb(r));
  end if;
  summary:=case category when 'unsupported' then 'Туслах хүсэлтийг ойлгож гүйцэтгэж чадсангүй. Ямар боломж дутсаныг ажилтнаас тодруулна уу.' when 'save_failed' then 'Туслахаар баталгаажуулсан үйлдлийг хадгалж чадсангүй. Шалтгааныг шалгах шаардлагатай.' else trim(p->>'summary') end;
  if summary is null or length(summary) not between 5 and 600 then raise exception 'Хүсэлтээ 5–600 тэмдэгтээр тайлбарлана уу'; end if;
  if category<>'suggestion' then
   select t.* into r from public.staff_improvement_requests t where t.created_by=auth.uid() and t.staff_id is not distinct from employee
    and t.category=p->>'category' and t.operation=p->>'operation' and t.status<>'done' and t.created_at>now()-interval '1 day' order by t.id desc limit 1 for update;
   if found then
    update public.staff_improvement_requests set occurrences=occurrences+1,last_seen_at=now(),revision=revision+1 where id=r.id returning * into r;
    return jsonb_build_object('request',to_jsonb(r),'deduplicated',true);
   end if;
  end if;
  if (select count(*) from public.staff_improvement_requests where created_by=auth.uid() and created_at>now()-interval '1 hour')>=20 then raise exception 'Олон хүсэлт илгээгдлээ. Өмнөх хүсэлтийн төлөвийг шалгана уу'; end if;
  insert into public.staff_improvement_requests(request_id,created_by,staff_id,category,operation,summary) values(req,auth.uid(),employee,category,operation,summary) returning * into r;
  return jsonb_build_object('request',to_jsonb(r));
 elsif a='update' then
  if not public.is_admin() then raise exception 'Зөвхөн админ хүсэлтийн төлөв өөрчилнө' using errcode='42501'; end if;
  select * into r from public.staff_improvement_requests where id=(p->>'id')::bigint for update;
  if not found then raise exception 'Хүсэлт олдсонгүй'; end if;
  if (p->>'expected_revision')::int is distinct from r.revision then raise exception 'Хүсэлт шинэчлэгдсэн байна. Дахин ачаална уу' using errcode='40001'; end if;
  if p->>'status' is null or p->>'status' not in ('new','in_review','needs_info','planned','done') or length(trim(coalesce(p->>'admin_note',''))) not between 5 and 600 then raise exception 'Төлөв болон ажилтанд өгөх тайлбарыг оруулна уу'; end if;
  update public.staff_improvement_requests set status=p->>'status',admin_note=trim(p->>'admin_note'),revision=revision+1,last_seen_at=now(),
   updates=updates||jsonb_build_array(jsonb_build_object('by',auth.uid(),'at',now(),'from',r.status,'to',p->>'status','note',trim(p->>'admin_note')))
  where id=r.id returning * into r;
  return jsonb_build_object('request',to_jsonb(r));
 end if;
 raise exception 'Үйлдэл буруу';
end $$;
revoke all on function private.staff_improvement_inbox(jsonb) from public,anon;
grant execute on function private.staff_improvement_inbox(jsonb) to authenticated;
create function public.staff_improvement_inbox(p jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.staff_improvement_inbox(p)$$;
revoke all on function public.staff_improvement_inbox(jsonb) from public,anon;
grant execute on function public.staff_improvement_inbox(jsonb) to authenticated;
