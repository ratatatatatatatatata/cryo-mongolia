// The same arithmetic is revalidated in the database. Missing historical
// base/bonus splits are never inferred from a total or a cell colour.
export function calculateEntitlement(baseInput, mode, bonusInput) {
  if (baseInput === '' || baseInput == null || bonusInput === '' || bonusInput == null)
    throw new Error('Үндсэн болон урамшууллын тоог оруулна уу.');
  const base = Number(baseInput), value = Number(bonusInput);
  if (!Number.isSafeInteger(base) || base < 0 || base > 1000 || !['count','percent'].includes(mode) || !Number.isFinite(value) || value < 0 || value > 1000 || Math.abs(value*100-Math.round(value*100))>1e-7)
    throw new Error('Үндсэн тоо болон урамшууллаа зөв оруулна уу.');
  const calculated = mode === 'percent' ? base*Math.round(value*100)/10000 : value;
  const bonus = Math.round(calculated);
  if (Math.abs(calculated-bonus)>1e-9 || base+bonus<1 || base+bonus>1000)
    throw new Error('Нийт оролт 1–1000 бүхэл тоо байна. Бутархай урамшууллыг тоогоор оруулна уу.');
  return {base_units:base,bonus_mode:mode,bonus_value:value,bonus_units:bonus,units:base+bonus};
}

const safe = v => String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

export function createPackageEditor({sb,getStaffId,getServices,onSaved,getActorKey=()=>''}) {
  const dialog=document.createElement('dialog');
  dialog.className='package-editor'; dialog.setAttribute('aria-labelledby','pkgEditTitle');
  document.body.append(dialog);
  let snapshot=null, requestId=null, dirty=false, saving=false, formStaff=null, formActor='', generation=0, attemptedPayload=null;
  const close=()=>{if(saving)return;if(dirty&&!window.confirm('Хадгалаагүй засвараа орхиод хаах уу?'))return;dialog.close();dirty=false;generation++;};
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
  const status=text=>{dialog.querySelector('[data-status]').textContent=text;};
  function update() {
    let total=0,spent=0,valid=true;
    dialog.querySelectorAll('[data-item]').forEach(row=>{
      const used=Number(row.dataset.used);spent+=used;
      try {
        const e=calculateEntitlement(row.querySelector('[data-base]').value,row.querySelector('[data-mode]').value,row.querySelector('[data-bonus]').value);
        if(e.units<used)throw new Error('Ашигласан оролтоос бага байж болохгүй.');
        total+=e.units;row.querySelector('output').textContent=`Үндсэн ${e.base_units} + урамшуулал ${e.bonus_units} = нийт ${e.units} · Ашигласан ${used} · Үлдсэн ${e.units-used}`;
      } catch(e){valid=false;row.querySelector('output').textContent=e.message;}
    });
    dialog.querySelector('[data-total]').textContent=valid?`Нийт ${total} · Ашигласан ${spent} · Үлдсэн ${total-spent}`:'Үндсэн / урамшууллын задаргааг баталгаажуулна уу.';
    dialog.querySelector('[data-save]').disabled=!valid||saving;
  }
  function addRow(item) {
    const used=snapshot.history.filter(h=>Number(h.service_id)===Number(item.service_id)).reduce((sum,h)=>sum+Number(h.units),0);
    const row=document.createElement('section');row.className='package-edit-row';row.dataset.item=item.service_id;row.dataset.used=used;
    row.innerHTML=`<h3>${safe(item.service_name)}</h3><small>Одоогийн нийт: ${item.units==null?'шинээр нэмэх':safe(item.units)} · Ашигласан: ${used}${item.base_units==null?' · Өмнөх үндсэн/урамшууллын задаргаа бүртгээгүй':''}</small><div class="package-edit-fields"><label>Үндсэн оролт<input class="ctl" data-base type="number" min="0" max="1000" step="1" required value="${safe(item.base_units??'')}"></label><label>Урамшууллын хэлбэр<select class="ctl" data-mode><option value="count">Оролтын тоо</option><option value="percent">Үндсэн тооны %</option></select></label><label>Урамшуулал<input class="ctl" data-bonus type="number" min="0" max="1000" step="0.01" required value="${safe(item.bonus_value??0)}"></label></div><output aria-live="polite"></output>`;
    row.querySelector('[data-mode]').value=item.bonus_mode||'count';
    dialog.querySelector('[data-items]').append(row);
  }
  async function open(contractId) {
    if(dialog.open)return;
    const epoch=++generation;formStaff=getStaffId()||null;formActor=getActorKey();dirty=false;saving=false;snapshot=null;attemptedPayload=null;
    dialog.innerHTML='<h2 id="pkgEditTitle">Авсан багцыг тохируулах</h2><p data-status role="status">Багцын шинэ мэдээллийг авч байна…</p><button type="button" data-close class="btn-sm ghost">Хаах</button>';
    dialog.querySelector('[data-close]').onclick=close;dialog.showModal();
    try {
      const r=await sb.rpc('customer_package_editor',{p:{action:'read',contract_id:contractId,staff_id:formStaff}});if(r.error)throw r.error;
      if(epoch!==generation||!dialog.open)return;
      snapshot=r.data;requestId=crypto.randomUUID();const c=snapshot.contract;
      if(c.status==='cancelled')throw new Error('Цуцалсан багцыг энэ хэсгээс засахгүй.');
      if(snapshot.history.some(h=>h.service_id==null))throw new Error('Үйлчилгээ нь тодорхойгүй хуучин ашиглалт байна. Админаар эхлээд тулгуулна уу.');
      dialog.innerHTML=`<form><div class="panel-head"><h2 id="pkgEditTitle">Авсан багцыг тохируулах</h2><button type="button" data-close class="btn-sm ghost">Хаах</button></div><p><b>${safe(c.customer_label)}</b> · Багц #${safe(c.id)}</p><p class="notice">Зөвхөн энэ хүний авсан багц өөрчлөгдөнө. Төлбөр, ашигласан оролт, бусад хүний багц болон ерөнхий загвар өөрчлөгдөхгүй.</p><div class="package-edit-fields"><label>Багцын нэр<input class="ctl" name="label" maxlength="120" required value="${safe(c.package_label)}"></label><label>Хүчинтэй хугацааны сүүлийн өдөр<input class="ctl" name="expiry" type="date" min="${safe(c.purchased_on||'')}" max="2100-12-31" value="${safe(c.expires_on||'')}"><small>Хоосон бол хугацааны хязгааргүй.</small></label></div><div data-items></div><label>Үйлчилгээ нэмэх<select class="ctl" data-add><option value="">Сонгох</option></select></label><p data-total role="status"></p><label>Өөрчлөх шалтгаан<textarea class="ctl" name="reason" minlength="5" maxlength="500" required placeholder="Жишээ: Үндсэн 4, урамшуулал 2 оролт олгохоор баталсан."></textarea></label><p data-status role="status"></p><div class="form-actions"><button class="btn-sm primary" data-save type="submit">Шалгаад хадгалах</button></div></form>`;
      dialog.querySelector('[data-close]').onclick=close;
      const items=[...(c.service_units||[])];
      // Include services with historical usage even if the old entitlement has no breakdown.
      snapshot.history.forEach(h=>{if(!items.some(x=>Number(x.service_id)===Number(h.service_id))){const svc=getServices().find(s=>Number(s.id)===Number(h.service_id));items.push({service_id:h.service_id,service_name:svc?.name||`Үйлчилгээ #${h.service_id}`});}});
      items.forEach(addRow);
      const add=dialog.querySelector('[data-add]');
      const refreshAdd=()=>{add.replaceChildren(new Option('Сонгох',''));getServices().filter(s=>s.active&&!dialog.querySelector(`[data-item="${Number(s.id)}"]`)).forEach(s=>add.add(new Option(s.name,String(s.id))));};refreshAdd();
      add.onchange=()=>{const svc=getServices().find(s=>String(s.id)===add.value);if(!svc)return;addRow({service_id:svc.id,service_name:svc.name,base_units:1,bonus_value:0});dirty=true;refreshAdd();update();};
      dialog.querySelector('form').addEventListener('input',()=>{dirty=true;update();});
      dialog.querySelector('form').addEventListener('change',()=>{dirty=true;update();});
      dialog.querySelector('form').onsubmit=async e=>{
        e.preventDefault();if(saving)return;
        if((getStaffId()||null)!==formStaff||getActorKey()!==formActor){status('Бүртгэх ажилтан солигдсон байна. Хааж дахин нээгээд шалгана уу.');return;}
        try {
          const items=[...dialog.querySelectorAll('[data-item]')].map(row=>({service_id:Number(row.dataset.item),...calculateEntitlement(row.querySelector('[data-base]').value,row.querySelector('[data-mode]').value,row.querySelector('[data-bonus]').value)}));
          const p={action:'save',request_id:requestId,staff_id:formStaff,contract_id:c.id,expected_token:snapshot.token,package_label:dialog.querySelector('[name=label]').value.trim(),expires_on:dialog.querySelector('[name=expiry]').value||null,reason:dialog.querySelector('[name=reason]').value.trim(),items};
          const signature=JSON.stringify({...p,request_id:null});
          if(attemptedPayload&&attemptedPayload!==signature){status('Өмнөх хадгалалтын үр дүн тодорхойгүй байж болзошгүй. Хааж дахин нээгээд шалгана уу.');return;}
          if(!window.confirm(`${c.customer_label} · ${p.package_label}\n${dialog.querySelector('[data-total]').textContent}\nШалтгаан: ${p.reason}\nТөлбөр ба ашиглалтын түүх хэвээр үлдэнэ. Хадгалах уу?`))return;
          attemptedPayload=signature;saving=true;update();status('Хадгалж байна…');
          const result=await sb.rpc('customer_package_editor',{p});if(result.error)throw result.error;
          if(epoch!==generation||getActorKey()!==formActor)return;
          dirty=false;dialog.close();generation++;await onSaved(result.data.contract);
        }catch(error){status(error.code==='PGRST202'?'Багц засах шинэ боломж серверт хараахан холбогдоогүй байна.':error.message||'Хадгалж чадсангүй. Мэдээлэл хэвээр байна.');}
        finally{saving=false;if(dialog.open)update();}
      };
      update();dialog.querySelector('[name=label]').focus();
    } catch(error){status(error.code==='PGRST202'?'Багц засах шинэ боломж серверт хараахан холбогдоогүй байна.':error.message||'Багц ачаалж чадсангүй.');}
  }
  return {open,reset(){generation++;dirty=false;saving=false;snapshot=null;dialog.close();dialog.replaceChildren();}};
}
