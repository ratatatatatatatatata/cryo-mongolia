-- Using more than a gift card holds: the card is emptied and the difference is
-- taken as an extra payment, recorded in today's sales.
alter table public.gift_card_uses add column if not exists extra_amount bigint not null default 0 check (extra_amount >= 0);
alter table public.gift_card_uses add column if not exists extra_method text check (extra_method in ('golomt','khan','cash','barter'));
alter table public.gift_card_uses add column if not exists sale_id bigint references public.sales(id) on delete set null;

create or replace function private.use_gift_card(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare employee bigint:=nullif(p->>'staff_id','')::bigint; req uuid:=nullif(p->>'request_id','')::uuid;
 card public.gift_cards%rowtype; u public.gift_card_uses%rowtype; s public.sales%rowtype; v_amount bigint; spent bigint;
 extra bigint:=coalesce(nullif(p->>'extra_amount','')::numeric,0)::bigint; method text:=nullif(p->>'extra_method','');
 today date:=(now() at time zone 'Asia/Ulaanbaatar')::date; v_service text:=nullif(btrim(coalesce(p->>'service','')),'');
begin
 perform private.require_cryo_staff(employee);
 if req is null then raise exception 'Бүртгэлийн дугаар шаардлагатай'; end if;
 select * into u from public.gift_card_uses where request_id=req;
 if found then return jsonb_build_object('use',to_jsonb(u),'sale',(select to_jsonb(x) from public.sales x where x.id=u.sale_id)); end if;
 select * into card from public.gift_cards where id=(p->>'card_id')::bigint for update;
 if not found or card.archived_at is not null then raise exception 'Gift card олдсонгүй'; end if;
 if (p->>'amount') is null or (p->>'amount')::numeric<>trunc((p->>'amount')::numeric) then raise exception 'Дүнг бүхэл тоогоор оруулна уу'; end if;
 v_amount:=(p->>'amount')::bigint;
 select coalesce(sum(amount),0) into spent from public.gift_card_uses where card_id=card.id;
 if v_amount<=0 or v_amount>card.amount-spent then raise exception 'Gift card-ын үлдэгдэл %₮ байна',card.amount-spent; end if;
 if extra<0 or extra>2147483647 then raise exception 'Нэмэлт төлбөрийн дүн буруу'; end if;
 if extra>0 then
  -- An extra payment only makes sense once the card itself is used up.
  if v_amount<>card.amount-spent then raise exception 'Нэмэлт төлбөр авахын өмнө картын үлдэгдэл %₮-г бүрэн хасна',card.amount-spent; end if;
  if method is null or method not in ('golomt','khan','cash','barter') then raise exception 'Нэмэлт төлбөрийн хэлбэрээ сонгоно уу'; end if;
  insert into public.sales(sale_date,customer_name,phone,services,staff_id,therapist,golomt,khan,cash,barter,gift_card,source,source_key,created_by,note)
   values(today,card.recipient_name,card.recipient_phone,coalesce(v_service,'Gift card '||card.code),employee,(select name from public.staff where id=employee),
    case when method='golomt' then extra else 0 end,case when method='khan' then extra else 0 end,case when method='cash' then extra else 0 end,case when method='barter' then extra else 0 end,
    v_amount,'manual','gift-card-extra:'||req,auth.uid(),'Gift card '||card.code||' · картаас '||v_amount||'₮ · нэмэлт төлбөр '||extra||'₮') returning * into s;
 end if;
 insert into public.gift_card_uses(card_id,used_on,amount,service,note,staff_id,request_id,created_by,extra_amount,extra_method,sale_id)
  values(card.id,case when extra>0 then today else coalesce(nullif(p->>'used_on','')::date,today) end,v_amount,v_service,nullif(btrim(coalesce(p->>'note','')),''),employee,req,auth.uid(),extra,case when extra>0 then method end,s.id)
  returning * into u;
 return jsonb_build_object('use',to_jsonb(u),'balance',card.amount-spent-v_amount,'sale',case when s.id is null then null else to_jsonb(s) end);
end $$;
