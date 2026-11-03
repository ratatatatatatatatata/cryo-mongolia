(() => {
 'use strict';
 // Deep links and return visits open immediately; the welcome runs once per tab.
 if(location.hash||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 try{if(sessionStorage.getItem('cryo-intro-seen'))return;}catch{}
 if(!HTMLElement.prototype.animate||!HTMLDialogElement.prototype.showModal)return;
 const dialog=document.createElement('dialog');dialog.className='site-intro';dialog.setAttribute('aria-label','CRYO Mongolia');
 dialog.innerHTML='<div class="intro-scene"><div class="intro-orbit" aria-hidden="true"></div><img class="intro-logo" src="logo.svg" alt="CRYO Mongolia"/><div class="intro-name" translate="no">CRYO MONGOLIA</div><p class="intro-tagline" translate="no">PREMIUM RECOVERY &amp; LONGEVITY CENTER</p></div><button class="intro-skip" type="button">Алгасах →</button>';
 document.body.append(dialog);let finished=false;const animations=[];const previous=document.activeElement,previousOverflow=document.body.style.overflow;
 function finish(){if(finished)return;finished=true;clearTimeout(failSafe);animations.forEach(a=>a.cancel());dialog.close();dialog.remove();document.body.style.overflow=previousOverflow;if(previous&&previous!==document.body)previous.focus({preventScroll:true});try{sessionStorage.setItem('cryo-intro-seen','1');}catch{}}
 const failSafe=setTimeout(finish,3000);
 dialog.querySelector('button').onclick=finish;dialog.addEventListener('cancel',e=>{e.preventDefault();finish();});
 addEventListener('pagehide',finish,{once:true});
 try{
  dialog.showModal();document.body.style.overflow="hidden";
  const logo=dialog.querySelector('img'),orbit=dialog.querySelector('.intro-orbit');
  animations.push(logo.animate([{transform:'translate3d(-35vw,18vh,-700px) rotateY(-280deg) rotateZ(-18deg) scale(.3)'},{transform:'translate3d(8vw,-3vh,70px) rotateY(-35deg) rotateZ(5deg) scale(1.08)',offset:.65},{transform:'translate3d(0,0,0) rotateY(0) rotateZ(0) scale(1)'}],{duration:1750,easing:'cubic-bezier(.2,.8,.2,1)',fill:'both'}));
  animations.push(orbit.animate([{transform:'rotateX(68deg) rotateZ(-180deg) scale(.6)'},{transform:'rotateX(68deg) rotateZ(180deg) scale(1)'}],{duration:2100,easing:'cubic-bezier(.2,.8,.2,1)',fill:'both'}));
  dialog.querySelectorAll('.intro-name,.intro-tagline').forEach((el,i)=>animations.push(el.animate([{clipPath:'inset(100% 0 0 0)',transform:'translateY(20px)'},{clipPath:'inset(0 0 0 0)',transform:'translateY(0)'}],{duration:650,delay:850+i*120,fill:'both',easing:'cubic-bezier(.2,.8,.2,1)'})));
  const exit=dialog.animate([{clipPath:'inset(0 0 0 0)'},{clipPath:'inset(0 0 100% 0)'}],{duration:450,delay:1950,easing:'cubic-bezier(.76,0,.18,1)',fill:'both'});animations.push(exit);exit.finished.then(finish,()=>{});
 }catch{finish();}
})();
