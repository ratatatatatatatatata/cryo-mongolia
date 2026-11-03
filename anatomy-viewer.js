(() => {
 'use strict';
 const panel=document.querySelector('.anatomy-panel');if(!panel)return;
 const parts=[
  {id:'head',name:'Толгой',x:450,y:145,zoom:3.8},
  {id:'shoulder',name:'Мөр',x:340,y:300,zoom:3.2},
  {id:'chest',name:'Цээж',x:450,y:350,zoom:3},
  {id:'abdomen',name:'Хэвлий',x:445,y:500,zoom:3},
  {id:'hand',name:'Гар',x:750,y:650,zoom:3.4},
  {id:'knee',name:'Өвдөг',x:405,y:895,zoom:3.5},
  {id:'shin',name:'Шилбэ',x:410,y:1080,zoom:3.2}
 ];
 const tr=s=>window.CryoI18n?.t(s)||s,ns='http://www.w3.org/2000/svg';
 const dialog=document.createElement('dialog');dialog.className='anatomy-viewer';dialog.setAttribute('aria-labelledby','av-title');
 dialog.innerHTML=`<div class="av-shell"><header class="av-header"><div><span class="av-eyebrow">CRYO / HUMAN ANATOMY</span><h2 id="av-title">Бүтэн бие</h2></div><button type="button" class="av-close">Хаах ×</button></header><div class="av-main"><div class="av-stage"><svg viewBox="0 0 900 1350" role="img" aria-labelledby="av-title"><image href="photos/about-anatomy-3d.webp" width="900" height="1350"/><circle class="av-marker" r="30" cx="450" cy="675" hidden="hidden"/></svg></div><aside class="av-side"><span class="av-eyebrow">Биеийн хэсэг сонгох</span><p>Нэрийг сонгоход зураг тухайн хэсэг рүү ойртоно.</p><nav class="av-parts" aria-label="Биеийн хэсэг сонгох"></nav></aside></div><footer class="av-footer"><button type="button" class="av-reset">Бүтэн бие</button><label><span>Томруулах</span><input type="range" min="1" max="5" step="0.1" value="1" aria-label="Томруулах"/><output>1.0×</output></label><p>Танилцуулгын дүрслэл</p></footer></div>`;
 document.body.append(dialog);
 const svg=dialog.querySelector('svg'),marker=dialog.querySelector('.av-marker'),range=dialog.querySelector('input'),title=dialog.querySelector('h2');
 let selected=null,focusReturn=null,overflow='',raf=0,box=[0,0,900,1350];
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 function destination(zoom){const w=900/zoom,h=1350/zoom,x=selected?.x??450,y=selected?.y??675;return [Math.max(0,Math.min(900-w,x-w/2)),Math.max(0,Math.min(1350-h,y-h/2)),w,h];}
 function move(zoom,animate=true){cancelAnimationFrame(raf);const target=destination(zoom),from=[...box],start=performance.now();range.value=zoom;dialog.querySelector('output').textContent=Number(zoom).toFixed(1)+'×';
  const frame=now=>{const p=reduced.matches||!animate?1:Math.min(1,(now-start)/700),ease=p*p*(3-2*p);box=from.map((v,i)=>v+(target[i]-v)*ease);svg.setAttribute('viewBox',box.join(' '));if(p<1)raf=requestAnimationFrame(frame);};raf=requestAnimationFrame(frame);
 }
 function select(part){selected=part;title.textContent=tr(part?.name||'Бүтэн бие');marker.style.display=part?'':'none';marker.removeAttribute('hidden');if(part){marker.setAttribute('cx',part.x);marker.setAttribute('cy',part.y);}
  dialog.querySelectorAll('[data-part]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.part===part?.id)));dialog.querySelector('.av-reset').setAttribute('aria-pressed',String(!part));move(part?.zoom||1);
 }
 function open(part){focusReturn=document.activeElement;overflow=document.body.style.overflow;box=[0,0,900,1350];svg.setAttribute('viewBox',box.join(' '));dialog.showModal();document.body.style.overflow='hidden';select(part);dialog.querySelector('.av-close').focus();}
 function close(){cancelAnimationFrame(raf);dialog.close();document.body.style.overflow=overflow;focusReturn?.focus({preventScroll:true});}
 const labelY=[145,300,420,550,700,910,1100];
 parts.forEach((part,i)=>{
  const button=document.createElement('button');button.type='button';button.textContent=part.name;button.dataset.part=part.id;button.style.top=(part.y/1350*100)+'%';button.onclick=()=>open(part);panel.querySelector('.anatomy-labels').append(button);
  const line=document.createElementNS(ns,'path');line.setAttribute('d',`M${part.x} ${part.y} L${Math.max(part.x+30,650)} ${part.y} L850 ${labelY[i]}`);const dot=document.createElementNS(ns,'circle');dot.setAttribute('cx',part.x);dot.setAttribute('cy',part.y);dot.setAttribute('r',6);panel.querySelector('.anatomy-leaders').append(line,dot);
  const control=document.createElement('button');control.type='button';control.textContent=part.name;control.dataset.part=part.id;control.setAttribute('aria-pressed','false');control.onclick=()=>select(part);dialog.querySelector('.av-parts').append(control);
 });
 panel.querySelector('.anatomy-full').onclick=()=>open(null);dialog.querySelector('.av-close').onclick=close;dialog.querySelector('.av-reset').onclick=()=>select(null);range.oninput=()=>move(Number(range.value),false);dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
 dialog.addEventListener('keydown',e=>{if(e.target===range)return;if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const index=parts.indexOf(selected),next=(index+(e.key==='ArrowRight'?1:-1)+parts.length)%parts.length;select(parts[next]);}});
 document.addEventListener('cryo:languagechange',()=>{title.textContent=tr(selected?.name||'Бүтэн бие');});
 // Keep the leader lines and label rows aligned with the contained image at every size.
 function align(){const area=panel.querySelector('.anatomy-preview'),w=area.clientWidth,h=area.clientHeight,imageH=Math.min(h,w*1.5),top=(h-imageH)/2;panel.querySelectorAll('[data-part]').forEach((b,i)=>{b.style.top=(top+labelY[i]/1350*imageH)+'px';});}
 if('ResizeObserver' in window)new ResizeObserver(align).observe(panel.querySelector('.anatomy-preview'));else addEventListener('resize',align);align();
})();
