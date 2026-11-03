import {createRequire} from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(process.env.TEST_NODE_MODULES+'/package.json');
const {JSDOM}=require('jsdom');
for(const reduced of [false,true]){
 const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{runScripts:'outside-only',url:'https://cryomongolia.mn/'}),w=dom.window,d=w.document;
 w.matchMedia=()=>({matches:reduced});w.Element.prototype.animate=()=>({cancel(){}});
 w.eval(fs.readFileSync('anatomy-viewer.js','utf8'));
 const panel=d.querySelector('.anatomy-panel'),focus=panel.querySelector('.anatomy-focus');
 assert.equal(panel.querySelectorAll('.anatomy-slice').length,7);assert.equal(panel.querySelectorAll('.anatomy-labels button').length,7);
 assert(!d.querySelector('.anatomy-viewer'));assert(!d.querySelector('#treatments'));
 for(const button of panel.querySelectorAll('.anatomy-labels button')){
  button.click();assert(!focus.hidden);assert(panel.classList.contains('is-focused'));assert.equal(button.getAttribute('aria-pressed'),'true');assert.equal(panel.querySelector('.anatomy-selection').textContent,button.textContent);
  const [x,y,width,height]=focus.querySelector('svg').getAttribute('viewBox').split(' ').map(Number);assert(width<900&&height<1350&&x>=0&&y>=0&&x+width<=900&&y+height<=1350);
  button.click();assert(focus.hidden);assert(!panel.classList.contains('is-focused'));
 }
 panel.querySelector('button').click();panel.querySelector('.anatomy-full').click();assert(focus.hidden);
 panel.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert(!focus.hidden);
 panel.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert(focus.hidden);assert.equal(d.body.style.overflow,'');
 dom.window.close();
}
console.log('PASS inline region selection, seven slices, no dialog, bounded crops, toggle/reset, keyboard and reduced motion');
