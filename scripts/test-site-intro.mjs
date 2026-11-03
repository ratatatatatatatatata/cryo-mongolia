import {createRequire} from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(process.env.TEST_NODE_MODULES+'/package.json');
const {JSDOM}=require('jsdom');
const script=fs.readFileSync('site-intro.js','utf8');
for(const scenario of ['normal','reduced','hash','return','unsupported','failure']){
 const dom=new JSDOM('<body><main>Site</main></body>',{url:'https://cryomongolia.mn/'+(scenario==='hash'?'#about':''),runScripts:'outside-only'}),w=dom.window,d=w.document;
 w.matchMedia=()=>({matches:scenario==='reduced'});
 w.Element.prototype.animate=function(){if(scenario==='failure')throw Error('animation failed');return {finished:new Promise(()=>{}),cancel(){}};};
 if(scenario!=='unsupported')w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 if(scenario==='return')w.sessionStorage.setItem('cryo-intro-assembled-v1','1');
 w.eval(script);
 if(scenario==='normal'){assert.equal(d.querySelectorAll('.intro-logo path').length,4);assert(d.querySelector('.site-intro').open);assert.equal(d.body.style.overflow,'hidden');assert(!d.querySelector('.intro-skip'));d.querySelector('.site-intro').dispatchEvent(new w.Event('cancel',{cancelable:true}));assert(!d.querySelector('.site-intro'));assert.equal(d.body.style.overflow,'');assert.equal(w.sessionStorage.getItem('cryo-intro-assembled-v1'),'1');w.eval(script);assert(!d.querySelector('.site-intro'));}
 else assert(!d.querySelector('.site-intro'));
 dom.window.close();
}
for(const page of ['index','hub','cabin','xcryo','oxypro','ledpro','skinbolic','privacy','data-deletion'])assert(fs.readFileSync(page+'.html','utf8').includes('href="public-typography.css"'));
console.log('PASS no skip button, Escape dismissal, return visit, deep links, reduced motion, unsupported browser, animation failure and all public font links');
