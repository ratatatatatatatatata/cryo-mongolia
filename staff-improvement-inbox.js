export const REQUEST_STATUS={new:'Шинэ',in_review:'Шалгаж байна',needs_info:'Тодруулах зүйлтэй',planned:'Хийхээр төлөвлөсөн',done:'Шийдсэн'};
const safe=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const operations={unknown:'Тодорхойгүй хүсэлт',booking:'Захиалга',payment:'Төлбөр',package:'Багц',gift:'Бэлгийн карт',team:'Спортын баг',attendance:'Ирц',customer:'Үйлчлүүлэгч',other:'Бусад'};
export function assistantOperation(intent) {
  if(['book','move','cancel','confirm','done','delete','provider','schedule','free','find'].includes(intent))return 'booking';
  if(['pay','income','sales'].includes(intent))return 'payment';
  if(['package','balance'].includes(intent))return 'package';
  if(['clockin','clockout'].includes(intent))return 'attendance';
  return ['gift','team','customer'].includes(intent)?intent:'unknown';
}
export function createImprovementInbox({getClient,getContext,openView}) {
  const $=id=>document.getElementById(id);
  const host=$('staffRequestList'),form=$('staffRequestForm');
  if(!host||!form)return {refresh:async()=>{},report:async()=>{},open:()=>{}};
  let loading=false,epoch=0,contextKey='',attempt=null;
  const pending=new Map(); // Keep request IDs on network retry, never the raw conversation.
  const key=c=>`${c?.userId||''}:${c?.staffId||''}:${!!c?.admin}`;
  const context=()=>{const c=getContext();return c?.userId&&(c.admin||c.staffId)?c:null;};
  const message=text=>{$('staffRequestStatus').textContent=text;};
  function open(){openView();void refresh();}
  async function rpc(p,c) {
    const r=await getClient().rpc('staff_improvement_inbox',{p:{...p,staff_id:c.staffId||null}});
    if(r.error)throw r.error;return r.data;
  }
  function errorText(e){return e?.code==='PGRST202'?'Хүсэлтийн шинэ хэсэг серверт хараахан холбогдоогүй байна.':e?.message||'Илгээж чадсангүй. Дахин оролдоно уу.';}
  async function refresh(){
    const c=context(),current=key(c);
    if(current!==contextKey){contextKey=current;epoch++;loading=false;host.replaceChildren();form.reset();attempt=null;pending.clear();$('staffRequestBadge').textContent='';}
    if(!c){message('Нэвтэрч, бүртгэх ажилтны нэрээ сонгоно уу.');return;}
    if(loading||host.querySelector('[data-dirty]'))return;loading=true;const version=epoch;
    try {
      const data=await rpc({action:'list'},c);if(version!==epoch||key(context())!==current)return;
      $('staffRequestBadge').textContent=data.open_count?String(data.open_count):'';
      $('staffRequestScope').textContent=data.is_admin?'Ажилтнуудаас ирсэн хүсэлтүүд · нээлттэй '+data.open_count:'Таны илгээсэн хүсэлтүүд · нээлттэй '+data.open_count;
      if(attempt&&(data.requests||[]).some(r=>r.request_id===attempt.id))attempt=null;
      host.innerHTML=(data.requests||[]).map(r=>`<article class="panel staff-request" data-request="${Number(r.id)}"><div class="panel-head"><b>#${Number(r.id)} · ${safe(operations[r.operation])}</b><span class="pill">${safe(REQUEST_STATUS[r.status])}</span></div><p>${safe(r.summary)}</p><p class="page-sub">${safe(r.staff_name||'Админ')} · ${safe(r.created_at.slice(0,16).replace('T',' '))} UTC · ${Number(r.occurrences)} удаа</p>${r.admin_note?`<p class="notice">Админы хариу: ${safe(r.admin_note)}</p>`:''}${data.is_admin?`<label>Төлөв<select class="ctl" data-status>${Object.entries(REQUEST_STATUS).map(([k,v])=>`<option value="${k}" ${r.status===k?'selected':''}>${v}</option>`).join('')}</select></label><label>Ажилтанд өгөх тайлбар<textarea class="ctl" data-note minlength="5" maxlength="600">${safe(r.admin_note)}</textarea></label><button class="btn-sm primary" data-save>Хариу хадгалах</button><p data-result role="status"></p>`:''}<details><summary>Хүсэлтийн явц</summary>${(r.updates||[]).map(u=>`<p>${safe(u.at)} · ${safe(REQUEST_STATUS[u.to])} · ${safe(u.note)}</p>`).join('')||'<p>Хараахан хариу өгөөгүй.</p>'}</details></article>`).join('')||'<p class="empty">Одоогоор хүсэлт алга.</p>';
      for(const r of data.requests||[]){const row=host.querySelector(`[data-request="${Number(r.id)}"]`),button=row.querySelector('[data-save]');if(!button)continue;row.addEventListener('input',()=>{row.dataset.dirty='1';});row.addEventListener('change',()=>{row.dataset.dirty='1';});button.onclick=async()=>{
        const note=row.querySelector('[data-note]').value.trim();if(note.length<5){row.querySelector('[data-result]').textContent='Тайлбарыг 5-аас доошгүй тэмдэгтээр оруулна уу.';return;}
        if(key(context())!==current)return;button.disabled=true;
        try{const updated=await rpc({action:'update',id:r.id,expected_revision:r.revision,status:row.querySelector('[data-status]').value,admin_note:note},c);r.revision=updated.request.revision;delete row.dataset.dirty;row.querySelector('[data-result]').textContent='Хариу хадгалагдлаа.';button.disabled=false;await refresh();}
        catch(e){row.querySelector('[data-result]').textContent=errorText(e);button.disabled=false;}
      };}
      message('Сүүлд шалгасан: '+new Date().toLocaleTimeString('mn-MN'));
    }catch(e){if(version===epoch)message(errorText(e));}finally{if(version===epoch)loading=false;}
  }
  async function report(category,operation='unknown') {
    const c=context();if(!c){$('asstEscalationStatus').textContent='Админд мэдэгдэхийн өмнө ажилтны нэрээ сонгоно уу.';return;}
    const k=`${key(c)}:${category}:${operation}`;let entry=pending.get(k);
    if(entry?.busy||entry?.sent)return;
    entry=entry||{id:crypto.randomUUID()};entry.busy=true;pending.set(k,entry);
    try{
      const data=await rpc({action:'report',request_id:entry.id,category,operation},c);entry.sent=true;
      if(key(context())===key(c)){$('asstEscalationStatus').textContent=`Админд #${data.request.id} хүсэлт бүртгэгдлээ. Яг ямар боломж хэрэгтэйг «Хүсэлт / явц»-д тайлбарлаж болно.`;await refresh();}
    }catch(e){if(key(context())===key(c))$('asstEscalationStatus').textContent='Админд автоматаар илгээгдээгүй. «Хүсэлт / явц»-аас дахин илгээнэ үү. '+errorText(e);}
    finally{entry.busy=false;}
  }
  form.onsubmit=async e=>{
    e.preventDefault();const c=context();if(!c)return message('Нэвтэрч, ажилтны нэрээ сонгоно уу.');
    const summary=$('staffRequestSummary').value.trim(),operation=$('staffRequestOperation').value;
    if(summary.length<5)return message('Ямар боломж хэрэгтэйг 5-аас доошгүй тэмдэгтээр тайлбарлана уу.');
    if(!window.confirm('Энэ тайлбарыг админд илгээх үү? Үйлчлүүлэгчийн нэр, утас, эрүүл мэндийн болон нууц мэдээлэл оруулаагүйг шалгана уу.'))return;
    const signature=JSON.stringify([key(c),operation,summary]);
    if(attempt&&attempt.signature!==signature)return message('Өмнөх хүсэлтийн үр дүн тодорхойгүй байна. «Дахин шалгах» дарж явцыг шалгана уу.');
    attempt=attempt||{signature,id:crypto.randomUUID()};const button=$('staffRequestSend');if(button.disabled)return;button.disabled=true;
    try{const data=await rpc({action:'report',request_id:attempt.id,category:'suggestion',operation,summary},c);if(key(context())===key(c)){attempt=null;form.reset();await refresh();message(`#${data.request.id} хүсэлт админд бүртгэгдлээ.`);}}
    catch(error){message(errorText(error));}finally{button.disabled=false;}
  };
  $('staffRequestRefresh').onclick=()=>{void refresh();};
  $('navStaffRequests').addEventListener('click',()=>{void refresh();});
  $('asstRequests').onclick=open;
  window.addEventListener('cryo:staff-changed',()=>{void refresh();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
  // In-app only: while the admin page is open and visible, refresh within 30s.
  setInterval(()=>{if(!document.hidden&&getContext()?.userId&&!host.querySelector('textarea:focus,select:focus')&&!form.contains(document.activeElement))void refresh();},30000);
  return {refresh,report,open};
}
