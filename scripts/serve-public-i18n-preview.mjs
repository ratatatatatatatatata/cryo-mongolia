// Local presentation QA only. No production backend, credentials or writes.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '_site');
const authStub = `const createClient = () => {
  const customer = new URL(location.href).searchParams.get('fixture') === 'customer';
  const user = {id:'test-customer',email:'test@example.invalid',user_metadata:{full_name:'Үйлчилгээ'}};
  const profile = {id:user.id,email:user.email,full_name:'Үйлчилгээ',role:'customer'};
  const result = {data:[],error:null};
  const query = {select(){return this},order(){return this},eq(){return this},maybeSingle(){return Promise.resolve({data:profile,error:null})},then(resolve){return Promise.resolve(result).then(resolve)}};
  return {auth:{getSession:async()=>({data:{session:customer?{user}:null}}),onAuthStateChange(){},signInWithPassword:async()=>({error:{message:'Invalid login credentials'}}),signUp:async()=>({error:null}),signInWithOAuth:async()=>({error:{message:'fixture unavailable'}}),signOut:async()=>({error:null})},from(){return query}};
};`;
const dataStub = `window.cryoData={ready:true,getBookableServices:async()=>({data:[{id:1,name:'Бүтэн биеийн бариа',duration_minutes:60},{id:2,name:'Цэвэр хүчилтөрөгч',duration_minutes:15}],error:null}),getBookingBlocks:async()=>({data:[],error:null}),subscribeBookingAvailability:()=>()=>{},saveBookings:async()=>({error:{message:'QA only: writes disabled'}}),saveContact:async()=>({error:{message:'QA only: writes disabled'}})};`;
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg'};
const server = http.createServer((req,res)=>{
  const url = new URL(req.url,'http://127.0.0.1');
  let name = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  if (!path.extname(name)) name += '.html';
  const file = path.resolve(root, name);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {res.writeHead(404);res.end('Not found');return;}
  if (req.method !== 'GET' && req.method !== 'HEAD') {res.writeHead(405);res.end('Read-only QA');return;}
  let body = fs.readFileSync(file);
  if (name === 'supabase-config.js') body = 'window.CRYO_SUPABASE={url:"https://example.invalid",anonKey:"fixture-not-a-key"};';
  if (name === 'auth.js') body = body.toString().replace(/^import .*createClient.*;$/m, authStub);
  if (name === 'data.js') body = dataStub;
  res.writeHead(200, {'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','Content-Security-Policy':"connect-src 'none'; frame-src 'none'"});
  res.end(body);
});
server.listen(8735,'127.0.0.1',()=>console.log('Read-only CRYO language QA at http://127.0.0.1:8735 — backend mocked, writes disabled'));
