import {createRequire} from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(process.env.TEST_NODE_MODULES+'/package.json');
const {JSDOM}=require('jsdom');
for(const reduced of [true,false]){
 const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{runScripts:'outside-only',url:'https://cryomongolia.mn/'});
 const w=dom.window,d=w.document;let frames=[],clock=0,booked=0;
 w.matchMedia=()=>({matches:reduced,addEventListener(){}});
 w.requestAnimationFrame=fn=>{frames.push(fn);return frames.length;};
 w.Element.prototype.animate=()=>({finished:Promise.resolve(),cancel(){}});
 w.Element.prototype.getAnimations=()=>[];
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.openModal=()=>booked++;
 w.eval(fs.readFileSync('device-shelf.js','utf8'));
 const flush=()=>{for(let i=0;i<250&&frames.length;i++){clock+=50;const batch=frames;frames=[];batch.forEach(fn=>fn(clock));}};
 flush();assert.equal(d.querySelectorAll('.dl-tape').length,15);assert.equal(d.querySelector('.dl-caption h3').textContent,'CryoCabin™');
 assert(!d.querySelector('#treatments'));assert(!d.body.textContent.includes('Сэргээн засах үйлчилгээний ангилал'));
 d.querySelector('[data-device-next]').click();flush();assert.equal(d.querySelector('.dl-caption h3').textContent,'X°Cryo™');
 d.querySelector('[data-device-category="oxygen"]').click();flush();assert.equal(d.querySelector('.dl-caption h3').textContent,'OxyPro™');
 d.querySelector('[data-device-open]').click();assert(d.querySelector('dialog').open);assert.equal(d.querySelector('#dl-title').textContent,'OxyPro™');assert(d.querySelector('.dl-more').href.endsWith('/oxypro.html'));
 d.querySelector('.dl-book').click();await Promise.resolve();await Promise.resolve();assert.equal(booked,1);assert(!d.querySelector('dialog').open);assert.equal(d.body.style.overflow,'');
 const viewport=d.querySelector('.dl-viewport');viewport.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));flush();assert.equal(d.querySelector('.dl-caption h3').textContent,'e°Cabin');
 viewport.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));flush();assert.equal(d.querySelector('.dl-caption h3').textContent,'CryoCabin™');
 for(const img of d.querySelectorAll('.dl-cover img'))assert(fs.existsSync(img.getAttribute('src')));
 dom.window.close();
}
console.log('PASS shelf navigation, category jump, wrap, detail, booking handoff, reduced motion and local images');
