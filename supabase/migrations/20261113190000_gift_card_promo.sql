-- Gift cards can be issued as «Урамшуулал» (promotion): free, so no sale and no
-- income is recorded when the card is given. Spending it still never counts as
-- revenue (sales.gift_card), and any extra payment above its value is real money.
alter table public.gift_cards drop constraint if exists gift_cards_payment_method_check;
alter table public.gift_cards add constraint gift_cards_payment_method_check
 check (payment_method in ('golomt','khan','cash','invoice','barter','internal','promo'));

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
 if method is null or method not in ('golomt','khan','cash','invoice','barter','internal','promo') then raise exception 'Төлбөрийн хэлбэр сонгоно уу'; end if;
 if v_code is not null and exists(select 1 from public.gift_cards where lower(btrim(code))=lower(v_code)) then raise exception 'Энэ дугаартай gift card бүртгэлтэй байна'; end if;
 insert into public.gift_cards(code,issued_on,buyer_name,buyer_phone,recipient_name,recipient_phone,amount,payment_method,note,staff_id,request_id,created_by)
  values(coalesce(v_code,'GC-'||req),day,v_buyer,nullif(btrim(coalesce(p->>'buyer_phone','')),''),v_recipient,nullif(btrim(coalesce(p->>'recipient_phone','')),''),v_amount,method,nullif(btrim(coalesce(p->>'note','')),''),employee,req,auth.uid())
  returning * into card;
 if v_code is null then update public.gift_cards set code='GC-'||lpad(card.id::text,4,'0') where id=card.id returning * into card; end if;
 -- A promotional card is free: no sale, nothing counted as income.
 if method='promo' then return jsonb_build_object('card',to_jsonb(card),'sale',null); end if;
 insert into public.sales(sale_date,customer_name,phone,services,staff_id,therapist,golomt,khan,cash,invoice,barter,internal_amount,is_internal,source,source_key,created_by,note)
  values(day,coalesce(v_buyer,v_recipient),coalesce(card.buyer_phone,card.recipient_phone),'Gift card '||card.code,employee,(select name from public.staff where id=employee),
   case when method='golomt' then v_amount else 0 end,case when method='khan' then v_amount else 0 end,case when method='cash' then v_amount else 0 end,
   case when method='invoice' then v_amount else 0 end,case when method='barter' then v_amount else 0 end,case when method='internal' then v_amount else 0 end,method='internal',
   'manual','gift-card:'||card.id,auth.uid(),'Gift card олгосон · авсан: '||v_recipient) returning * into s;
 update public.gift_cards set sale_id=s.id where id=card.id returning * into card;
 return jsonb_build_object('card',to_jsonb(card),'sale',to_jsonb(s));
end $$;
