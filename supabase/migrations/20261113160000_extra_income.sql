-- Extra income recorded straight into today's sales: oxygen balloons and
-- invoices, with where it came from, the amount and how it was paid.
create or replace function private.add_extra_income(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare employee bigint:=nullif(p->>'staff_id','')::bigint; req uuid:=nullif(p->>'request_id','')::uuid; s public.sales%rowtype;
 kind text:=p->>'kind'; method text:=p->>'payment_method'; v_from text:=btrim(regexp_replace(coalesce(p->>'source',''),'\s+',' ','g')); v_amount bigint;
 label text; today date:=(now() at time zone 'Asia/Ulaanbaatar')::date;
begin
 perform private.require_cryo_staff(employee);
 if req is null then raise exception 'Бүртгэлийн дугаар шаардлагатай'; end if;
 perform pg_advisory_xact_lock(hashtextextended('extra-income:'||req::text,0));
 select * into s from public.sales where source_key='extra-income:'||req;
 if found then return jsonb_build_object('sale',to_jsonb(s)); end if;
 label:=case kind when 'oxygen_balloon' then 'Oxygen balloon' when 'invoice' then 'Нэхэмжлэл' end;
 if label is null then raise exception 'Орлогын төрлөө сонгоно уу'; end if;
 if v_from='' or char_length(v_from)>160 then raise exception 'Хаанаас гэдгийг бөглөнө үү'; end if;
 if (p->>'amount') is null or (p->>'amount')::numeric<>trunc((p->>'amount')::numeric) then raise exception 'Үнийн дүнг бүхэл тоогоор оруулна уу'; end if;
 v_amount:=(p->>'amount')::bigint;
 if v_amount<=0 or v_amount>2147483647 then raise exception 'Үнийн дүн буруу'; end if;
 if method is null or method not in ('golomt','khan','cash','invoice','barter') then raise exception 'Төлбөрийн хэлбэрээ сонгоно уу'; end if;
 insert into public.sales(sale_date,customer_name,services,staff_id,therapist,golomt,khan,cash,invoice,barter,source,source_key,created_by,note)
  values(today,v_from,label,employee,(select name from public.staff where id=employee),
   case when method='golomt' then v_amount else 0 end,case when method='khan' then v_amount else 0 end,case when method='cash' then v_amount else 0 end,
   case when method='invoice' then v_amount else 0 end,case when method='barter' then v_amount else 0 end,
   'manual','extra-income:'||req,auth.uid(),concat_ws(' · ','Нэмэлт орлого',nullif(btrim(coalesce(p->>'note','')),''))) returning * into s;
 return jsonb_build_object('sale',to_jsonb(s));
end $$;
revoke all on function private.add_extra_income(jsonb) from public,anon;
grant execute on function private.add_extra_income(jsonb) to authenticated;
create or replace function public.add_extra_income(p jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.add_extra_income(p)$$;
revoke all on function public.add_extra_income(jsonb) from public,anon;
grant execute on function public.add_extra_income(jsonb) to authenticated;
