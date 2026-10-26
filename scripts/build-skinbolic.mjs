import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Authorized SKINBOLIC artwork: fetched at build time and served from our own domain.
export async function buildSkinbolic(output) {
  const groups=JSON.parse(await fs.readFile(new URL('./skinbolic-images.json',import.meta.url),'utf8'));
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const destination=path.join(output,'photos','skinbolic');
  await fs.mkdir(destination,{recursive:true});
  const jobs=groups.flatMap((images,g)=>images.map((url,i)=>({url,name:`${g+1}-${i+1}.jpg`})));
  let cursor=0;
  async function worker(){
    while(cursor<jobs.length){
      const {url,name}=jobs[cursor++];
      const target=path.join(destination,name);
      const cached=path.join(root,'photos','skinbolic',name);
      try{await fs.copyFile(cached,target);continue;}catch{}
      for(let attempt=1;attempt<=3;attempt++){
        try{
          const response=await fetch(url,{signal:AbortSignal.timeout(45000)});
          if(!response.ok)throw new Error(`HTTP ${response.status}`);
          const bytes=Buffer.from(await response.arrayBuffer());
          if(bytes.length<100||bytes[0]!==0xff||bytes[1]!==0xd8)throw new Error('Invalid JPEG');
          await fs.writeFile(target,bytes);break;
        }catch(error){if(attempt===3)throw new Error(`Skin Bolic ${name}: ${error.message}`);}
      }
    }
  }
  await Promise.all(Array.from({length:8},worker));
  console.log(`[skinbolic] staged ${jobs.length} authorized therapy images`);
}
