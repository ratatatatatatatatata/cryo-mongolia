import { matchesName } from './name-search.js';
// Staff-only data is supplied by the authenticated admin modules.
export function customerPicker(input, getRows, onSelect) {
  if (!input || input.dataset.customerPicker) return;
  input.dataset.customerPicker='true'; input.autocomplete='off';
  input.placeholder='Нэр эсвэл утсаар хайх';
  const list=document.createElement('div');list.className='customer-suggestions';list.hidden=true;
  list.setAttribute('role','list');input.after(list);
  // Overlay the list so opening/closing it never shifts the buttons below.
  if(input.parentElement&&!input.parentElement.style.position)input.parentElement.style.position='relative';
  const selected=document.createElement('small');list.after(selected);
  const render=()=>{
    const query=input.value.trim();list.replaceChildren();
    const rows=getRows().filter(c=>matchesName(c.full_name,query)||(query&&String(c.phone||'').replace(/\s/g,'').includes(query.replace(/\s/g,'')))).slice(0,30);
    list.hidden=false;
    for(const row of rows){
      const button=document.createElement('button');button.type='button';button.className='customer-suggestion';
      button.textContent=`${row.is_vip?'★ VIP · ':''}${row.full_name} · ${row.phone || 'Утас бүртгээгүй'}`;
      button.onclick=()=>{input.value=row.full_name;selected.textContent=`${row.full_name} · ${row.phone||'Утас бүртгээгүй'}`;onSelect(row);list.hidden=true;};list.append(button);
    }
    if(!rows.length&&query){const empty=document.createElement('p');empty.textContent=`Олдсонгүй — «${query}» шинэ үйлчлүүлэгчээр хадгалагдана. Хажууд нь утсаа оруулна уу.`;list.append(empty);}
  };
  input.addEventListener('input',()=>{selected.textContent='';onSelect(null);render();});input.addEventListener('focus',render);
  // Safari/Firefox on macOS don't focus a clicked button, so the input would blur and the list close
  // before the click lands. Keep focus in the input while a suggestion is being pressed.
  let pressing=false;
  list.addEventListener('pointerdown',()=>{pressing=true;});
  list.addEventListener('mousedown',event=>event.preventDefault());
  document.addEventListener('pointerup',()=>setTimeout(()=>{pressing=false;},0));
  input.addEventListener('blur',event=>{if(!pressing&&!list.contains(event.relatedTarget))list.hidden=true;});
  input.addEventListener('keydown',event=>{if(event.key==='Escape')list.hidden=true;if(event.key==='ArrowDown'){event.preventDefault();list.querySelector('button')?.focus();}});
  document.addEventListener('pointerdown',event=>{if(event.target!==input&&!list.contains(event.target))list.hidden=true;});
  list.addEventListener('focusout',()=>setTimeout(()=>{if(!list.contains(document.activeElement)&&document.activeElement!==input)list.hidden=true;},0));
}
