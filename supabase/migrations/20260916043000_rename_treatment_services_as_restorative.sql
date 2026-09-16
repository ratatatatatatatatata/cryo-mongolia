-- Align public service names with Cryo Mongolia's restorative-service terminology.
update public.services
set name = case slug
  when 'ledpro' then 'LedPro™ — Улаан гэрлийн сэргээн засах үйлчилгээ'
  when 'zerobody' then 'ZeroBody™ — Хуурай хөвөх сэргээн засах үйлчилгээ'
  else name
end,
updated_at = now()
where slug in ('ledpro', 'zerobody');
