-- Gift cards: who bought it, who received it, the day it was issued, its value,
-- and every deduction made against it. Selling a card is the revenue event;
-- spending it is recorded in sales.gift_card and never counted as cash again.

create table if not exists public.gift_cards (
  id bigint generated always as identity primary key,
  code text not null,
  issued_on date not null default ((now() at time zone 'Asia/Ulaanbaatar')::date),
  buyer_name text,
  buyer_phone text,
  recipient_name text not null check (char_length(btrim(recipient_name)) between 1 and 160),
  recipient_phone text,
  amount bigint not null check (amount > 0 and amount <= 2147483647),
  payment_method text check (payment_method in ('golomt','khan','cash','invoice','barter','internal')),
  sale_id bigint references public.sales(id) on delete set null,
  note text,
  staff_id bigint references public.staff(id),
  request_id uuid unique,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index if not exists gift_cards_code_unique on public.gift_cards (lower(btrim(code)));

create table if not exists public.gift_card_uses (
  id bigint generated always as identity primary key,
  card_id bigint not null references public.gift_cards(id) on delete cascade,
  used_on date not null default ((now() at time zone 'Asia/Ulaanbaatar')::date),
  amount bigint not null check (amount > 0),
  service text,
  note text,
  staff_id bigint references public.staff(id),
  request_id uuid unique,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists gift_card_uses_card_idx on public.gift_card_uses(card_id);

alter table public.gift_cards enable row level security;
alter table public.gift_card_uses enable row level security;
drop policy if exists "employees read gift cards" on public.gift_cards;
create policy "employees read gift cards" on public.gift_cards for select to authenticated using ((select public.is_cryo_employee()));
drop policy if exists "employees read gift card uses" on public.gift_card_uses;
create policy "employees read gift card uses" on public.gift_card_uses for select to authenticated using ((select public.is_cryo_employee()));
grant select on public.gift_cards, public.gift_card_uses to authenticated;
-- All writes go through the routines below.

create or replace function private.issue_gift_card(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare employee bigint:=nullif(p->>'staff_id','')::bigint; req uuid:=nullif(p->>'request_id','')::uuid;
 card public.gift_cards%rowtype; s public.sales%rowtype; v_amount bigint; method text:=nullif(p->>'payment_method','');
 v_code text:=nullif(btrim(coalesce(p->>'code','')),''); v_recipient text:=btrim(regexp_replace(coalesce(p->>'recipient_name',''),'\s+',' ','g'));
 v_buyer text:=nullif(btrim(regexp_replace(coalesce(p->>'buyer_name',''),'\s+',' ','g')),'');
 day date:=coalesce(nullif(p->>'issued_on','')::date,(now() at time zone 'Asia/Ulaanbaatar')::date);
begin
 perform private.require_cryo_staff(employee);
 if req is null then raise exception 'Бүртгэлийн дугаар шаардлагатай'; end if;
 perform pg_advisory_xact_lock(hashtextextended('gift:'||req::text,0));
 select * into card from public.gift_cards where request_id=req;
 if found then return jsonb_build_object('card',to_jsonb(card),'sale',(select to_jsonb(x) from public.sales x where x.id=card.sale_id)); end if;
 if v_recipient='' or char_length(v_recipient)>160 then raise exception 'Gift card авсан хүний нэрийг оруулна уу'; end if;
 if (p->>'amount') is null or (p->>'amount')::numeric<>trunc((p->>'amount')::numeric) then raise exception 'Үнийн дүнг бүхэл тоогоор оруулна уу'; end if;
 v_amount:=(p->>'amount')::bigint;
 if v_amount<=0 or v_amount>2147483647 then raise exception 'Үнийн дүн буруу'; end if;
 if method is null or method not in ('golomt','khan','cash','invoice','barter','internal') then raise exception 'Төлбөрийн хэлбэр сонгоно уу'; end if;
 if v_code is not null and exists(select 1 from public.gift_cards where lower(btrim(code))=lower(v_code)) then raise exception 'Энэ дугаартай gift card бүртгэлтэй байна'; end if;
 insert into public.gift_cards(code,issued_on,buyer_name,buyer_phone,recipient_name,recipient_phone,amount,payment_method,note,staff_id,request_id,created_by)
  values(coalesce(v_code,'GC-'||req),day,v_buyer,nullif(btrim(coalesce(p->>'buyer_phone','')),''),v_recipient,nullif(btrim(coalesce(p->>'recipient_phone','')),''),v_amount,method,nullif(btrim(coalesce(p->>'note','')),''),employee,req,auth.uid())
  returning * into card;
 if v_code is null then update public.gift_cards set code='GC-'||lpad(card.id::text,4,'0') where id=card.id returning * into card; end if;
 insert into public.sales(sale_date,customer_name,phone,services,staff_id,therapist,golomt,khan,cash,invoice,barter,internal_amount,is_internal,source,source_key,created_by,note)
  values(day,coalesce(v_buyer,v_recipient),coalesce(card.buyer_phone,card.recipient_phone),'Gift card '||card.code,employee,(select name from public.staff where id=employee),
   case when method='golomt' then v_amount else 0 end,case when method='khan' then v_amount else 0 end,case when method='cash' then v_amount else 0 end,
   case when method='invoice' then v_amount else 0 end,case when method='barter' then v_amount else 0 end,case when method='internal' then v_amount else 0 end,method='internal',
   'manual','gift-card:'||card.id,auth.uid(),'Gift card олгосон · авсан: '||v_recipient) returning * into s;
 update public.gift_cards set sale_id=s.id where id=card.id returning * into card;
 return jsonb_build_object('card',to_jsonb(card),'sale',to_jsonb(s));
end $$;

create or replace function private.use_gift_card(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare employee bigint:=nullif(p->>'staff_id','')::bigint; req uuid:=nullif(p->>'request_id','')::uuid;
 card public.gift_cards%rowtype; u public.gift_card_uses%rowtype; v_amount bigint; spent bigint;
begin
 perform private.require_cryo_staff(employee);
 if req is null then raise exception 'Бүртгэлийн дугаар шаардлагатай'; end if;
 select * into u from public.gift_card_uses where request_id=req;
 if found then return jsonb_build_object('use',to_jsonb(u)); end if;
 select * into card from public.gift_cards where id=(p->>'card_id')::bigint for update;
 if not found or card.archived_at is not null then raise exception 'Gift card олдсонгүй'; end if;
 if (p->>'amount') is null or (p->>'amount')::numeric<>trunc((p->>'amount')::numeric) then raise exception 'Дүнг бүхэл тоогоор оруулна уу'; end if;
 v_amount:=(p->>'amount')::bigint;
 select coalesce(sum(amount),0) into spent from public.gift_card_uses where card_id=card.id;
 if v_amount<=0 or v_amount>card.amount-spent then raise exception 'Gift card-ын үлдэгдэл %₮ байна',card.amount-spent; end if;
 insert into public.gift_card_uses(card_id,used_on,amount,service,note,staff_id,request_id,created_by)
  values(card.id,coalesce(nullif(p->>'used_on','')::date,(now() at time zone 'Asia/Ulaanbaatar')::date),v_amount,nullif(btrim(coalesce(p->>'service','')),''),nullif(btrim(coalesce(p->>'note','')),''),employee,req,auth.uid())
  returning * into u;
 return jsonb_build_object('use',to_jsonb(u),'balance',card.amount-spent-v_amount);
end $$;

-- Administrators correct mistakes: undo one deduction, or archive / restore a card.
create or replace function private.manage_gift_card(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare card public.gift_cards%rowtype;
begin
 if not public.is_admin() then raise exception 'Зөвхөн админ засна' using errcode='42501'; end if;
 if p->>'action'='remove_use' then
  delete from public.gift_card_uses where id=(p->>'use_id')::bigint;
  return jsonb_build_object('removed',(p->>'use_id')::bigint);
 elsif p->>'action' in ('archive','restore') then
  update public.gift_cards set archived_at=case when p->>'action'='archive' then now() else null end where id=(p->>'card_id')::bigint returning * into card;
  if not found then raise exception 'Gift card олдсонгүй'; end if;
  return jsonb_build_object('card',to_jsonb(card));
 end if;
 raise exception 'Буруу үйлдэл';
end $$;

do $$ declare fn text; begin
 foreach fn in array array['issue_gift_card','use_gift_card','manage_gift_card'] loop
  execute format('revoke all on function private.%I(jsonb) from public,anon',fn);
  execute format('grant execute on function private.%I(jsonb) to authenticated',fn);
  execute format('create or replace function public.%I(p jsonb) returns jsonb language sql security invoker set search_path='''' as $f$select private.%I(p)$f$',fn,fn);
  execute format('revoke all on function public.%I(jsonb) from public,anon',fn);
  execute format('grant execute on function public.%I(jsonb) to authenticated',fn);
 end loop;
end $$;
