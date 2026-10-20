import XLSX from 'xlsx';
const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
export function serviceId(label) {
 const s=clean(label).toLowerCase();
 if (/cryo\s*cabin/.test(s)) return 1;
 if (/x\s*cryo|spot/.test(s)) return 2;
 if (/led|red light/.test(s)) return 3;
 if (/oxy\s*pro/.test(s)) return 4;
 if (/zerobody/.test(s)) return 5;
 if (/normatec|compression/.test(s)) return 6;
 if (/oxygen/.test(s)) return 7;
 if (/body therapy/.test(s)) return 8;
 if (/beauty|гоо\s*сайхан/.test(s)) return 9;
 return null;
}
function ymd(y,m,d) {
 const date=new Date(Date.UTC(y,m-1,d));
 return y>=2000 && y<=2100 && date.getUTCMonth()===m-1 && date.getUTCDate()===d ? `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}` : null;
}
export function datesInCell(cell,year) {
 if (!cell || cell.v==null) return [];
 if (cell.t==='n' && XLSX.SSF.is_date(cell.z || '')) {
  const d=XLSX.SSF.parse_date_code(cell.v); return d ? [ymd(d.y,d.m,d.d)].filter(Boolean) : [];
 }
 if (cell.v instanceof Date) return [ymd(cell.v.getFullYear(),cell.v.getMonth()+1,cell.v.getDate())].filter(Boolean);
 const out=[];
 const re=/(\d{4})[./-](\d{1,2})[./-](\d{1,2})|(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?/g;
 for(const m of clean(cell.v).matchAll(re)) {
  const a=+m[4],b=+m[5];
  const date=m[1] ? ymd(+m[1],+m[2],+m[3]) : ymd(+(m[6]||year),a>12?b:a,a>12?a:b);
  if(date) out.push(date);
 }
 return out;
}
export function isRed(cell) {
 const rgb=cell?.s?.fgColor?.rgb?.slice(-6);
 if(cell?.s?.patternType!=='solid' || !rgb) return false;
 const [r,g,b]=rgb.match(/../g).map(x=>parseInt(x,16));
 return r>150 && r-g>25 && r-b>25 && Math.abs(g-b)<60;
}
export function isWhite(cell) {
 if (!cell) return true; // An unstyled blank inside a bounded service block is white.
 if (!cell.s || cell.s.patternType === 'none') return true;
 const rgb=cell.s.fgColor?.rgb?.slice(-6);
 if (!rgb) return cell.s.fgColor?.theme === 0;
 const channels=rgb.match(/../g).map(x=>parseInt(x,16));
 return Math.min(...channels)>=235 && Math.max(...channels)-Math.min(...channels)<=5;
}
export function readPackages(wb,sheet,year) {
 const ws=wb.Sheets[sheet], range=XLSX.utils.decode_range(ws['!ref']);
 const cell=(r,c)=>ws[XLSX.utils.encode_cell({r,c})];
 const merges=ws['!merges']||[];
 let layout=null; const contracts=[],redemptions=[],warnings=[];
 for(let r=range.s.r;r<=range.e.r;r++) {
  const row=Array.from({length:range.e.c+1},(_,c)=>clean(cell(r,c)?.v));
  const nameCol=row.findIndex(v=>v.includes('ХАРИЛЦАГЧ'));
  if(nameCol>=0) {
   const blocks=[];
   row.forEach((label,c)=>{
    const id=serviceId(label); if(!id) return;
    const merge=merges.find(m=>m.s.r===r&&m.s.c===c);
    const count=+(label.match(/(\d+)\s*$/)||[])[1];
    blocks.push({label,from:c,to:Math.min(range.e.c, merge?.e.c ?? (count ? c+count-1 : c)),serviceId:id});
   });
   layout={nameCol,descCol:row.findIndex(v=>/Багцын тоо|Мэдээлэл/.test(v)),startCol:row.findIndex(v=>v.includes('эхэлсэн')),blocks}; continue;
  }
  if(!layout) continue;
  const customer=row[layout.nameCol];
  if(!customer || /^(total|нийт|teenager pack|id\b)/i.test(customer)) continue;
  // Merged section headings and metadata never create customer entitlements.
  if(merges.some(m=>m.s.r===r&&m.s.c===layout.nameCol&&m.e.c>layout.nameCol)) continue;
  for(const b of layout.blocks) {
   let remaining=0;const used=[];
   for(let c=b.from;c<=b.to;c++) {
    const v=cell(r,c);
    if(isRed(v)) continue;
    const merge=merges.find(m=>r>=m.s.r&&r<=m.e.r&&c>=m.s.c&&c<=m.e.c);
    if(merge && (merge.s.r!==r || merge.s.c!==c)) continue;
    const dates=datesInCell(v,year);
    dates.forEach((date,n)=>used.push({date,key:`${sheet}:${r+1}:${c}:${n}`,serviceId:b.serviceId,label:b.label}));
    if(!dates.length && !clean(v?.v) && !merge && isWhite(v)) remaining++;
    else if(!dates.length && clean(v?.v)) warnings.push(`${sheet}!${XLSX.utils.encode_cell({r,c})}: note, not a session`);
   }
   const total=used.length+remaining;if(!total)continue;
   const key=`${sheet}:${r+1}:${b.from}`;
   contracts.push({key,customer,label:b.label,start:datesInCell(cell(r,layout.startCol),year)[0]||null,total,remaining,status:remaining?'active':'completed',notes:row[layout.descCol]||null,sheet,row:r+1,serviceId:b.serviceId});
   used.forEach(u=>redemptions.push({contractKey:key,...u}));
  }
 }
 return {contracts,redemptions,warnings};
}
