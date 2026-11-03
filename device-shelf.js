/* Device edition of the turning-cover shelf. Existing equipment photography and copy. */
(() => {
  'use strict';
  const root = document.querySelector('.device-library');
  if (!root) return;
  const devices = [
    {name:'CryoCabin™',cat:'cryo',image:'photos/img-cabin-2.png',sub:'Бүхэл биеийн криотерапи',meta:'−200°C · 3 минут',description:'Шингэн азотаар ажилладаг бүхэл биеийн хүйтний сэргээн засах үйлчилгээ — −200°C хүртэл',href:'cabin.html'},
    {name:'X°Cryo™',cat:'cryo',image:'photos/img-xcryo-1.png',sub:'Локал крио',meta:'1–3 минут',description:'Биеийн тодорхой хэсгийн локал криотерапи — 1–3 минут',href:'xcryo.html'},
    {name:'LedPro™',cat:'light',image:'photos/img-ledpro-1.png',sub:'Улаан гэрэл',meta:'28,515 LED · 15 минут',description:'Улаан болон инфра улаан гэрлийн сэргээн засах үйлчилгээ — 28,515 LED',href:'ledpro.html'},
    {name:'OxyPro™',cat:'oxygen',image:'photos/img-oxypro-1.png',sub:'Хүчилтөрөгч',meta:'1.4 ATA · 30 минут',description:'Хөнгөн даралтын хүчилтөрөгчийн камер.',href:'oxypro.html'},
    {name:'e°Cabin',cat:'cryo',image:'photos/img-ecabin.png',sub:'Электрик крио',meta:'Цахилгаан · Автомат',description:'Цахилгаан эрчим хүчээр ажилладаг бүрэн автоматжуулсан бүх биеийн криотерапийн кабин',href:'hub.html'}
  ];
  const viewport=root.querySelector('.dl-viewport'), stage=root.querySelector('.dl-stage'), dialog=document.querySelector('.dl-detail');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const n=devices.length, count=n*3, mod=(x,m)=>((x%m)+m)%m, smooth=x=>x*x*(3-2*x);
  const tr=text=>window.CryoI18n?.t(text)||text;
  let s=n,T=n,active=-1,H=300,ws=50,depth=158,gap=9,frame=0,last=0,inView=true,drag=null,suppressClick=false,hover=-1,tiltX=0,tiltY=0,tx=0,ty=0,returnFocus=null,closing=false;
  const tapes=[];
  for(let v=0;v<count;v++){
    const d=devices[v%n],button=document.createElement('button');button.type='button';button.className='dl-tape';button.tabIndex=-1;
    // All strings below are static, owned equipment data.
    button.innerHTML=`<span class="dl-face dl-spine"><small>CRYO</small><b>${d.name}</b><i>${String(v%n+1).padStart(2,'0')}</i></span><span class="dl-face dl-cover"><small>CRYO MONGOLIA</small><strong>${d.name}</strong><img src="${d.image}" alt=""/><span>${d.sub}</span></span>`;
    button.setAttribute('aria-label',d.name);button.onclick=()=>{if(suppressClick)return;const r=relative(v);if(Math.abs(r)<.5)openDetail();else{T=Math.round(T+r);wake();}};
    button.onpointerenter=()=>{hover=v;wake();};button.onpointerleave=()=>{hover=-1;wake();};
    stage.append(button);tapes.push({button,sp:button.querySelector('.dl-spine'),cv:button.querySelector('.dl-cover'),lift:0});
  }
  function relative(v){return mod(v-s+count/2,count)-count/2;}
  function measure(){H=parseFloat(getComputedStyle(tapes[0].sp).height)||300;ws=H*142/840;depth=H*474/900;gap=H*.03;stage.style.setProperty('--ws',ws+'px');stage.style.setProperty('--depth',depth+'px');wake();}
  function caption(force=false){const next=mod(Math.round(s),n);if(next===active&&!force)return;active=next;const d=devices[active];
    root.querySelectorAll('.dl-caption h3,.dl-caption p,.dl-caption small').forEach((line,i)=>{const span=document.createElement('span');span.textContent=tr([d.name,d.sub,d.meta][i]);line.replaceChildren(span);if(!reduced.matches)span.animate([{transform:`translateY(${T>=s?110:-110}%)`},{transform:'translateY(0)'}],{duration:650,easing:'cubic-bezier(.2,.8,.2,1)'});});
    root.querySelectorAll('[data-device-category]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.deviceCategory===d.cat)));
  }
  function wake(){if(!frame&&inView&&!dialog.open){last=performance.now();frame=requestAnimationFrame(tick);}}
  function tick(now){frame=0;const dt=Math.min((now-last)/1000,.05);last=now;s=reduced.matches?T:s+(T-s)*(1-Math.exp(-(drag?18:5.2)*dt));if(Math.abs(T-s)<.0001)s=T;
    if(Math.abs(s)>count*4){const shift=Math.trunc(s/count)*count;s-=shift;T-=shift;}
    tiltX+=(tx-tiltX)*(1-Math.exp(-7*dt));tiltY+=(ty-tiltY)*(1-Math.exp(-7*dt));let moving=Math.abs(T-s)>.0001||Math.abs(tx-tiltX)>.01||Math.abs(ty-tiltY)>.01;
    tapes.forEach((t,v)=>{const r=relative(v),o=smooth(Math.max(0,1-Math.abs(r))),B=Math.abs(r)<1?(r+Math.sin(Math.PI*r)/Math.PI)/2:Math.sign(r)*.5;
      const x=r*(ws+gap)+(depth-ws+1.6*gap)*B;const visible=Math.abs(x)<viewport.clientWidth/2+depth*1.5;
      t.button.style.visibility=visible?'visible':'hidden';t.button.setAttribute('aria-hidden',String(!visible));t.button.tabIndex=Math.abs(r)<.5?0:-1;
      const target=hover===v&&Math.abs(r)>.5?1:0;t.lift=reduced.matches?target:t.lift+(target-t.lift)*(1-Math.exp(-12*dt));moving ||= Math.abs(target-t.lift)>.001;if(!visible)return;
      t.button.style.transform=`translate3d(${x}px,${-o*.025*H-t.lift*.045*H}px,${o*.2*H}px) rotateZ(${-4.5*o}deg) rotateX(${reduced.matches?0:tiltX*o}deg) rotateY(${-90*o+(reduced.matches?0:tiltY*o)}deg)`;
      t.button.style.zIndex=Math.round(100-Math.abs(r)*4);t.sp.style.setProperty('--shade',o*.55);t.cv.style.setProperty('--shade',(1-o)*.5);
    });caption();if(moving&&inView&&!dialog.open)frame=requestAnimationFrame(tick);
  }
  function step(dir){T=Math.round(T)+dir;wake();}
  root.querySelector('[data-device-prev]').onclick=()=>step(-1);root.querySelector('[data-device-next]').onclick=()=>step(1);root.querySelector('[data-device-open]').onclick=openDetail;
  root.querySelectorAll('[data-device-category]').forEach(b=>b.onclick=()=>{const i=b.dataset.deviceCategory==='all'?0:devices.findIndex(d=>d.cat===b.dataset.deviceCategory);T+=mod(i-mod(Math.round(T),n)+n/2,n)-n/2;T=Math.round(T);wake();});
  viewport.onkeydown=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();step(e.key==='ArrowLeft'?-1:1);}else if(e.key==='Enter'&&e.target===viewport){e.preventDefault();openDetail();}};
  let wheelTimer;
  viewport.addEventListener('wheel',e=>{if(Math.abs(e.deltaX)<=Math.abs(e.deltaY))return;e.preventDefault();T+=e.deltaX/(ws+gap)*.5;clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>{T=Math.round(T);wake();},160);wake();},{passive:false});
  viewport.onpointerdown=e=>{if(e.button!==0)return;drag={x:e.clientX,t:T,id:e.pointerId,moved:false};suppressClick=false;};
  viewport.onpointermove=e=>{if(drag&&e.pointerId===drag.id){const dx=e.clientX-drag.x;if(Math.abs(dx)>5){drag.moved=true;viewport.setPointerCapture(e.pointerId);}if(drag.moved){T=drag.t-dx/(ws+gap);wake();}}
    const rect=viewport.getBoundingClientRect();tx=-(e.clientY-rect.top-rect.height/2)/(H/2)*6;ty=(e.clientX-rect.left-rect.width/2)/(depth*.55)*9;tx=Math.max(-6,Math.min(6,tx));ty=Math.max(-9,Math.min(9,ty));wake();};
  function endDrag(){if(!drag)return;suppressClick=drag.moved;drag=null;T=Math.round(T);wake();setTimeout(()=>{suppressClick=false;},0);}
  viewport.onpointerup=endDrag;viewport.onpointercancel=endDrag;viewport.onpointerleave=()=>{tx=ty=0;wake();};
  function coverRect(){const tape=tapes.reduce((best,t,v)=>Math.abs(relative(v))<Math.abs(relative(best))?v:best,0);return tapes[tape].cv.getBoundingClientRect();}
  function sheetFrames(rect){const clip=`inset(${Math.max(0,rect.top)}px ${Math.max(0,innerWidth-rect.right)}px ${Math.max(0,innerHeight-rect.bottom)}px ${Math.max(0,rect.left)}px round 3px)`;return [{clipPath:clip,transform:'rotate(-4.5deg)'},{clipPath:'inset(0px 0px 0px 0px)',transform:'rotate(0)'}];}
  function openDetail(){if(dialog.open)return;T=Math.round(s);const d=devices[mod(T,n)];returnFocus=document.activeElement;const rect=coverRect();
    dialog.querySelector('#dl-title').textContent=d.name;dialog.querySelector('.dl-kicker').textContent=tr(d.sub);dialog.querySelector('.dl-meta').textContent=tr(d.meta);dialog.querySelector('.dl-description').textContent=tr(d.description);dialog.querySelector('.dl-more').href=d.href;
    const img=dialog.querySelector('img');img.src=d.image;img.alt=d.name;oldOverflow=document.body.style.overflow;dialog.showModal();document.body.style.overflow='hidden';dialog.querySelector('.dl-close').focus();
    if(!reduced.matches){dialog.animate(sheetFrames(rect),{duration:1050,easing:'cubic-bezier(.76,0,.18,1)'});dialog.querySelectorAll('.dl-detail-copy>*').forEach((el,i)=>el.animate([{clipPath:'inset(100% 0 0 0)',transform:'translateY(30px)'},{clipPath:'inset(0 0 0 0)',transform:'translateY(0)'}],{duration:900,delay:620+i*75,fill:'backwards',easing:'cubic-bezier(.2,.8,.2,1)'}));img.animate([{clipPath:'circle(0% at 35% 40%)'},{clipPath:'circle(150% at 35% 40%)'}],{duration:1600,delay:520,fill:'backwards',easing:'cubic-bezier(.2,.8,.2,1)'});}
  }
  let oldOverflow='';
  async function closeDetail(instant=false){if(closing||!dialog.open)return;closing=true;if(!reduced.matches&&!instant)await dialog.animate(sheetFrames(coverRect()).reverse(),{duration:650,easing:'cubic-bezier(.76,0,.18,1)'}).finished;dialog.getAnimations().forEach(a=>a.cancel());dialog.close();document.body.style.overflow=oldOverflow;closing=false;returnFocus?.focus({preventScroll:true});wake();}
  dialog.querySelector('.dl-close').onclick=()=>closeDetail();dialog.addEventListener('cancel',e=>{e.preventDefault();closeDetail();});dialog.querySelector('.dl-book').onclick=async()=>{await closeDetail(true);window.openModal?.();};
  addEventListener('resize',measure);document.addEventListener('cryo:languagechange',()=>caption(true));reduced.addEventListener('change',wake);
  if('IntersectionObserver' in window)new IntersectionObserver(entries=>{inView=entries[0].isIntersecting;if(inView)wake();},{rootMargin:'100px'}).observe(root);
  measure();
})();
