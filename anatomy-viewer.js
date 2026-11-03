(() => {
 'use strict';
 const panel=document.querySelector('.anatomy-panel');if(!panel)return;
 const parts=[
  {id:'head',name:'Толгой',x:450,y:145,box:[385,40,140,200]},
  {id:'shoulder',name:'Мөр',x:340,y:300,box:[265,235,160,170]},
  {id:'chest',name:'Цээж',x:450,y:350,box:[320,275,290,160]},
  {id:'abdomen',name:'Хэвлий',x:445,y:500,box:[345,405,230,190]},
  {id:'hand',name:'Гар',x:750,y:650,box:[690,575,155,150]},
  {id:'knee',name:'Өвдөг',x:405,y:895,box:[345,825,215,160]},
  {id:'shin',name:'Шилбэ',x:410,y:1080,box:[350,980,220,240]}
 ];
 const ns='http://www.w3.org/2000/svg',tr=s=>window.CryoI18n?.t(s)||s;
 const preview=panel.querySelector('.anatomy-preview'),svg=preview.querySelector('svg'),labels=panel.querySelector('.anatomy-labels'),leaders=svg.querySelector('.anatomy-leaders');
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');let selected=null,animation;
 function element(tag,attrs={}){const el=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,v));return el;}
 const source=svg.querySelector('image');const defs=element('defs');svg.prepend(defs);
 const cuts=[0,230,330,430,580,760,990,1350],layers=[];
 for(let i=0;i<7;i++){
  const clip=element('clipPath',{id:'anatomy-slice-'+i});clip.append(element('rect',{x:0,y:cuts[i],width:900,height:cuts[i+1]-cuts[i]}));defs.append(clip);
  const layer=element('g',{'clip-path':`url(#anatomy-slice-${i})`,class:'anatomy-slice'});layer.append(source.cloneNode());svg.insertBefore(layer,leaders);layers.push(layer);
 }
 source.remove();
 const focus=document.createElement('div');focus.className='anatomy-focus';focus.hidden=true;
 const detail=element('svg',{role:'img','aria-label':'Биеийн хэсэг'});detail.append(element('image',{href:'photos/about-anatomy-3d.webp',width:900,height:1350}));const detailDefs=element('defs'),detailClip=element('clipPath',{id:'anatomy-focus-clip'}),detailRect=element('rect');detailClip.append(detailRect);detailDefs.append(detailClip);detail.prepend(detailDefs);detail.querySelector('image').setAttribute('clip-path','url(#anatomy-focus-clip)');focus.append(detail);preview.append(focus);
 const status=document.createElement('span');status.className='anatomy-selection';status.setAttribute('aria-live','polite');panel.querySelector('.anatomy-full').after(status);
 function select(part){animation?.cancel();selected=part;panel.classList.toggle('is-focused',!!part);focus.hidden=!part;
  labels.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.part===part?.id)));
  layers.forEach((layer,i)=>{layer.style.transform=part?`translate(${i%2?55:-55}px,${(i-3)*28}px) rotate(${i%2?3:-3}deg)`:'none';});
  status.textContent=part?tr(part.name):'';
  if(!part)return;
  ['x','y','width','height'].forEach((key,i)=>detailRect.setAttribute(key,part.box[i]));detail.setAttribute('viewBox',part.box.join(' '));detail.setAttribute('aria-label',tr(part.name));
  if(!reduced.matches&&focus.animate){animation=focus.animate([{transform:'translate(-12%,8%) scale(.32) rotateY(-35deg) rotateZ(-8deg)',opacity:0},{transform:'translate(0,0) scale(1) rotateY(-8deg) rotateZ(-2deg)',opacity:1}],{duration:750,easing:'cubic-bezier(.2,.8,.2,1)',fill:'both'});}
 }
 const labelY=[145,300,420,550,700,910,1100];
 parts.forEach((part,i)=>{
  const button=document.createElement('button');button.type='button';button.textContent=part.name;button.dataset.part=part.id;button.setAttribute('aria-pressed','false');button.onclick=()=>select(selected===part?null:part);labels.append(button);
  const line=element('path',{d:`M${part.x} ${part.y} L650 ${part.y} L850 ${labelY[i]}`}),dot=element('circle',{cx:part.x,cy:part.y,r:6});leaders.append(line,dot);
 });
 panel.querySelector('.anatomy-full').onclick=()=>select(null);
 panel.addEventListener('keydown',e=>{if(e.key==='Escape'){select(null);}else if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const i=parts.indexOf(selected),next=(i+(e.key==='ArrowRight'?1:-1)+parts.length)%parts.length;select(parts[next]);labels.querySelector(`[data-part="${parts[next].id}"]`).focus();}});
 document.addEventListener('cryo:languagechange',()=>{status.textContent=selected?tr(selected.name):'';if(selected)detail.setAttribute('aria-label',tr(selected.name));});
 function align(){const w=preview.clientWidth,h=preview.clientHeight,imageH=Math.min(h,w*1.5),top=(h-imageH)/2;labels.querySelectorAll('button').forEach((b,i)=>b.style.top=(top+labelY[i]/1350*imageH)+'px');}
 if('ResizeObserver' in window)new ResizeObserver(align).observe(preview);else addEventListener('resize',align);align();
})();
