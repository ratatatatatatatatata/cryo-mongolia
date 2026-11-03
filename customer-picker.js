import { matchesName } from './name-search.js';
// Staff-only data is supplied by the authenticated admin modules.
export function customerPicker(input, getRows, onSelect) {
  if (!input || input.dataset.customerPicker) return;
  input.dataset.customerPicker='true'; input.autocomplete='off';
  input.placeholder='Нэр эсвэл утсаар хайх';
  const list=document.createElement('div');list.className='customer-suggestions';list.hidden=true;
  list.setAttribute('role','list');input.after(list);
  const selected=document.createElement('small');list.after(selected);
  const render=()=>{
    const query=input.value.trim();list.replaceChildren();
    const rows=getRows().filter(c=>matchesName(c.full_name,query)||(query&&String(c.phone||'').replace(/\s/g,'').includes(query.replace(/\s/g,'')))).slice(0,30);
    list.hidden=false;
    for(const row of rows){
      const button=document.createElement('button');button.type='button';button.className='customer-suggestion';
      button.textContent=`${row.full_name} · ${row.phone || 'Утас бүртгээгүй'}`;
      button.onclick=()=>{input.value=row.full_name;selected.textContent=`${row.full_name} · ${row.phone||'Утас бүртгээгүй'}`;onSelect(row);list.hidden=true;};list.append(button);
    }
    if(!rows.length){const empty=document.createElement('p');empty.textContent='Үйлчлүүлэгч олдсонгүй. Шинэ үйлчлүүлэгч бол нэр, утсаа бүртгэнэ үү.';list.append(empty);}
  };
  input.addEventListener('input',()=>{selected.textContent='';onSelect(null);render();});input.addEventListener('focus',render);
  input.addEventListener('keydown',event=>{if(event.key==='Escape')list.hidden=true;if(event.key==='ArrowDown'){event.preventDefault();list.querySelector('button')?.focus();}});
  document.addEventListener('pointerdown',event=>{if(event.target!==input&&!list.contains(event.target))list.hidden=true;});
  list.addEventListener('focusout',()=>setTimeout(()=>{if(!list.contains(document.activeElement)&&document.activeElement!==input)list.hidden=true;},0));
}
