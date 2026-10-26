/* Skin Bolic locale uses the same preference as the public CRYO site. */
(() => {
'use strict';
const pairs = [
['Үндсэн цэс','Main navigation'],['Нүүр','Home'],['Холбоо барих','Contact'],
['Арьс арчилгааны хөтөлбөрүүдтэй танилцаарай. Сонирхсон арчилгаагаа сонгоод зураг, найрлага, хэрэглээний дэлгэрэнгүй танилцуулгыг эндээс үзээрэй.','Explore the skin-care programs. Choose a therapy to view its images, ingredients and detailed application information here.'],
['Арчилгааны жагсаалт','Therapy collection'],['Арчилгаа хайх','Search therapies'],['Нэр, найрлагаар хайх…','Search by name or ingredient…'],['Төрөл','Category'],['Бүх арчилгаа','All therapies'],['Бие','Body'],['Үнэрт тос','Aroma'],['Төхөөрөмж','Device'],
['Электропорацийн арчилгаа','Electroporation care'],['Алттай арчилгаа','Gold care'],['Какаотой арчилгаа','Cacao care'],['Сүүтэй арчилгаа','Milk care'],['Лимонтой арчилгаа','Lemon care'],['Цайны модтой арчилгаа','Tea tree care'],['Үнэрт тосны арчилгаа','Aromatic oil care'],['Биеийн арчилгаа','Body care'],['Гуужуулах арчилгаа','Peeling care'],['Насжилтын үеийн арчилгаа','Aging-skin care'],['Витаминтай арчилгаа','Vitamin care'],
['Өтгөрүүлсэн ампулыг электропорацийн төхөөрөмжтэй хослуулсан арьс арчилгаа.','Concentrated ampoules combined with electroporation skin care.'],
['Алт агуулсан бүтээгдэхүүнээр арьсны өнгө, уян хатан байдлыг арчлах хөтөлбөр.','Gold-containing products for skin tone and elasticity care.'],
['Какао агуулсан, арьсыг тэжээж тайвшруулахад чиглэсэн арчилгаа.','Cacao-based nourishing and relaxing skin care.'],
['Сүүний найрлагатай бүтээгдэхүүнээр арьсны өнгө, чангарлыг дэмжих арчилгаа.','Milk-based products for skin tone and firming care.'],
['Витамин C, биофлавоноид агуулсан, өнгөө алдсан арьсны арчилгаа.','Vitamin C and bioflavonoid care for a dull complexion.'],
['Илүүдэл тослог, асуудалтай арьсанд зориулсан цайны модны найрлагатай арчилгаа.','Tea tree care for excess oil and troubled skin.'],
['Үнэрт тосонд суурилсан тайвшруулах арчилгаа.','Relaxing care based on aromatic oils.'],
['Биеийн арьсны гадаргуу, хэлбэрийг арчлахад чиглэсэн хөтөлбөр.','A program focused on body-skin texture and contour care.'],
['Гуужуулалт, арьсны хамгаалах давхаргын арчилгааг хослуулсан хөтөлбөр.','A program combining exfoliation and skin-barrier care.'],
['Үйлдвэрлэгчийн танилцуулгаар насжилт, дааврын өөрчлөлтийн үед зориулсан арьс арчилгаа.','Presented by the manufacturer for skin care during aging and hormonal changes.'],
['COS-VCE найрлагатай, арьсны уян хатан байдал, тайвшруулалтад чиглэсэн витаминт арчилгаа.','Vitamin care with COS-VCE, focused on elasticity and soothing.'],
['Зураг, дэлгэрэнгүй мэдээлэл','Images and details'],['Тохирох арчилгаа олдсонгүй. Хайлтаа өөрчилж үзнэ үү.','No therapies found. Try a different search.'],
['SKINBOLIC-ийн албан ёсны зурагт танилцуулга. Арчилгааны сонголт, үнэ, цагийн боломжийг','Official SKINBOLIC illustrated presentation. For therapy options, prices and availability,'],['CRYO Mongolia-тай холбогдож','contact CRYO Mongolia'],['тодруулна уу.','for details.'],
['← Бүх арчилгаа','← All therapies'],['← Бүх арчилгаа руу буцах','← Back to all therapies'],['Үндсэн сайт руу буцах →','Back to the main site →'],
['Зураг дээр дарж томруулан уншина уу.','Click an image to enlarge it.'],['Томруулсан зураг','Enlarged image'],['Томруулах +','Zoom in +'],['Багасгах −','Zoom out −'],['Хаах ×','Close ×'],
['Эх зураг дахь бичвэрийн унших хувилбар зураг бүрийн доор MN / EN хэлээр харагдана. Эх зураг болон видеоны хэл өөрчлөгдөхгүй.','A readable MN / EN version of the artwork text appears below each image. Original image and video languages remain unchanged.'],
['Тайлбарууд нь үйлдвэрлэгчийн материалын орчуулга. Үр нөлөөний мэдэгдлүүд нь үйлдвэрлэгчийн тайлбар бөгөөд баталгаатай эмчилгээний үр дүн гэсэн үг биш.','The text translates the manufacturer’s materials. Benefit statements are manufacturer claims, not guaranteed treatment outcomes.'],
['Skin Bolic · Арьс арчилгаа | CRYO Mongolia','Skin Bolic · Skin care | CRYO Mongolia'],
['Skin Bolic-ийн 11 төрлийн Therapy арчилгааны монгол танилцуулга, албан ёсны дэлгэрэнгүй мэдээлэл.','Explore 11 Skin Bolic therapies with bilingual descriptions and official illustrated presentations.']
];
const dictionary=new Map(pairs), normal=v=>v.replace(/\s+/g,' ').trim();
const storageKey='cryo-public-language', query=new URLSearchParams(location.search);
let saved='mn';try{saved=localStorage.getItem(storageKey)||'mn'}catch{}
let language=['mn','en'].includes(query.get('lang'))?query.get('lang'):saved==='en'?'en':'mn';
const t=value=>language==='en'?(dictionary.get(normal(value))||value):value;
const search=document.getElementById('search'),category=document.getElementById('category'),cards=[...document.querySelectorAll('.therapy')];
const cardData=cards.map(card=>({name:card.querySelector('h2').textContent,subtitle:card.querySelector('h3').textContent,description:card.querySelector('p').textContent,category:card.dataset.category}));
// Capture the authored text before any language changes; input values remain untouched.
const records=[],walker=document.createTreeWalker(document.documentElement,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.parentElement&&!n.parentElement.closest('script,style,[data-no-translate]')?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT});
let node;while((node=walker.nextNode()))if(normal(node.data))records.push({node,source:node.data});
const attrs=[];document.querySelectorAll('[aria-label],[placeholder],meta[name="description"]').forEach(el=>{for(const key of ['aria-label','placeholder','content'])if(el.hasAttribute(key))attrs.push({el,key,value:el.getAttribute(key)})});
const counts=[1,3,14,10,9,2,2,3,17,18,12],videos={2:'uRNZ2K3yh-c',3:'G_Mr6wz0qCE',4:'iCuVb8ip8S8',5:'DLBlIFUjS9k'};
const selected=Number(query.get('therapy')),isDetail=Number.isInteger(selected)&&selected>=1&&selected<=cards.length;
const zoom=document.getElementById('zoom'),zoomImage=document.getElementById('zoom-image'),zoomSize=document.getElementById('zoom-size');
let zoomIndex=1;const galleryEntries=[];
function filter(){
 const q=search.value.trim().toLocaleLowerCase();let total=0;
 cards.forEach((card,i)=>{const d=cardData[i],terms=[d.name,d.subtitle,d.description,d.category,dictionary.get(d.subtitle)||'',dictionary.get(d.description)||''].join(' ').toLocaleLowerCase();card.hidden=!(terms.includes(q)&&(!category.value||d.category===category.value));if(!card.hidden)total++});
 document.getElementById('count').textContent=language==='en'?`${total} ${total===1?'therapy':'therapies'}`:`${total} арчилгаа`;
 document.getElementById('empty').hidden=total!==0;
}
function imageLabel(i){return language==='en'?`${cardData[selected-1].name} — original artwork ${i} / ${counts[selected-1]}`:`${cardData[selected-1].name} — эх танилцуулга ${i} / ${counts[selected-1]}`}
function zoomLabel(){zoomSize.textContent=t(zoomImage.classList.contains('enlarged')?'Багасгах −':'Томруулах +')}
if(isDetail){
 document.getElementById('catalog').hidden=true;document.getElementById('detail').hidden=false;
 for(let i=1;i<=counts[selected-1];i++){
  const figure=document.createElement('figure'),button=document.createElement('button'),img=document.createElement('img'),caption=document.createElement('figcaption');button.type='button';
  img.src=`photos/skinbolic/${selected}-${i}.jpg`;img.loading=i===1?'eager':'lazy';img.decoding='async';button.append(img);figure.append(button,caption);document.getElementById('gallery').append(figure);
  button.addEventListener('click',()=>{zoomIndex=i;zoomImage.src=img.src;zoomImage.alt=imageLabel(i);zoomImage.classList.remove('enlarged');zoomLabel();zoom.showModal();document.querySelector('.zoom-scroll').scrollTo(0,0)});
  galleryEntries.push({i,button,img,caption});
 }
 if(videos[selected]){const frame=document.createElement('iframe');frame.src='https://www.youtube-nocookie.com/embed/'+videos[selected];frame.loading='lazy';frame.allowFullscreen=true;frame.allow='encrypted-media; picture-in-picture';document.getElementById('video').append(frame)}
}
function render(){
 document.documentElement.lang=language;
 records.forEach(({node,source})=>{let value=t(source);if(node.parentElement?.matches('.tag,option')&&normal(source)==='Нүүр')value=language==='en'?'Face':'Нүүр';node.data=source.match(/^\s*/)[0]+value.trim()+source.match(/\s*$/)[0]});
 attrs.forEach(({el,key,value})=>el.setAttribute(key,t(value)));
 document.querySelectorAll('[data-language]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.language===language)));
 document.querySelector('.language-switch').setAttribute('aria-label',language==='en'?'Language':'Хэл');
 if(isDetail){const d=cardData[selected-1];document.title=`${d.name} | Skin Bolic · CRYO Mongolia`;document.getElementById('detail-title').textContent=d.name;document.getElementById('detail-intro').textContent=t(d.subtitle)+' · '+t(d.description);
  galleryEntries.forEach(({i,button,img,caption})=>{img.alt=imageLabel(i);button.setAttribute('aria-label',language==='en'?`Enlarge image ${i} — ${d.name}`:`${d.name} — ${i}-р зургийг томруулах`);caption.lang=language;caption.replaceChildren();const heading=document.createElement('h2');heading.textContent=language==='en'?`Image ${i} · Reading text`:`Зураг ${i} · Монгол орчуулга`;caption.append(heading);for(const paragraph of window.SkinbolicTranslations[`${selected}-${i}`][language].split('\n')){const p=document.createElement('p');p.textContent=paragraph;caption.append(p)}});
  const iframe=document.querySelector('#video iframe');if(iframe)iframe.title=d.name+(language==='en'?' — original video':' — эх танилцуулга видео');
  if(zoom.open)zoomImage.alt=imageLabel(zoomIndex);
 }
 zoomLabel();filter();
 // Explicit locale survives navigation even if storage is disabled.
 document.querySelectorAll('a[href]').forEach(a=>{const u=new URL(a.getAttribute('href'),location.href);if(u.origin===location.origin){u.searchParams.set('lang',language);a.setAttribute('href',u.pathname+u.search+u.hash)}});
}
function setLanguage(next){if(!['mn','en'].includes(next))return;language=next;try{localStorage.setItem(storageKey,next)}catch{}const url=new URL(location.href);url.searchParams.set('lang',next);history.replaceState(history.state,'',url);render()}
document.querySelectorAll('[data-language]').forEach(button=>button.addEventListener('click',()=>setLanguage(button.dataset.language)));
search.addEventListener('input',filter);category.addEventListener('change',filter);
document.getElementById('zoom-close').addEventListener('click',()=>zoom.close());zoomSize.addEventListener('click',()=>{zoomImage.classList.toggle('enlarged');zoomLabel()});
try{localStorage.setItem(storageKey,language)}catch{}
render();
})();
