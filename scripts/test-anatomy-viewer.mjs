import {createRequire} from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(process.env.TEST_NODE_MODULES+'/package.json');
const {JSDOM}=require('jsdom');
for(const reduced of [false,true]){
 const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{runScripts:'outside-only',url:'https://cryomongolia.mn/'}),w=dom.window,d=w.document;
 let queue=new Map(),id=0,clock=0;
 w.matchMedia=()=>({matches:reduced});w.requestAnimationFrame=fn=>{queue.set(++id,fn);return id;};w.cancelAnimationFrame=i=>queue.delete(i);
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.eval(fs.readFileSync('anatomy-viewer.js','utf8'));
 const flush=()=>{for(let i=0;i<40&&queue.size;i++){clock+=50;const batch=[...queue.values()];queue.clear();batch.forEach(fn=>fn(clock));}};
 const dialog=d.querySelector('.anatomy-viewer'),svg=dialog.querySelector('svg'),range=dialog.querySelector('input');
 assert.equal(d.querySelectorAll('.anatomy-labels button').length,7);
 for(const button of d.querySelectorAll('.anatomy-labels button')){
  button.focus();button.click();flush();assert(dialog.open);assert.equal(dialog.querySelector('h2').textContent,button.textContent);
  const [x,y,width,height]=svg.getAttribute('viewBox').split(' ').map(Number);assert(width<900&&height<1350);assert(x>=0&&y>=0&&x+width<=900.001&&y+height<=1350.001);
  range.value='5';range.dispatchEvent(new w.Event('input'));flush();assert.equal(Number(svg.getAttribute('viewBox').split(' ')[2]),180);
  dialog.querySelector('.av-reset').click();flush();assert.equal(svg.getAttribute('viewBox'),'0 0 900 1350');
  dialog.dispatchEvent(new w.Event('cancel',{cancelable:true}));assert(!dialog.open);assert.equal(d.activeElement,button);assert.equal(d.body.style.overflow,'');
 }
 d.querySelector('.anatomy-full').click();flush();assert.equal(svg.getAttribute('viewBox'),'0 0 900 1350');
 dialog.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));flush();assert.equal(dialog.querySelector('h2').textContent,'Толгой');
 dom.window.close();
}
console.log('PASS all seven region labels, bounded zoom, full-body reset, keyboard, Escape, focus return and reduced motion');
