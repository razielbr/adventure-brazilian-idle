// Servidor do Adventure Brazilian IDLE — sem dependências (Node 22+).
// Uso: ADMIN_TOKEN=uma-senha-longa node server.js   (porta 3000, ou PORT=...)
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const zlib=require('node:zlib');
// ================= BACKUP REMOTO (S3 / Cloudflare R2 / Backblaze B2 …) =================
// Para hospedagem SEM disco persistente (ex.: Render grátis): o banco é salvo num bucket S3 a cada ~2 min e
// ao desligar/deploy (SIGTERM); ao iniciar num container novo ele é restaurado do bucket. Sem dependências (assinatura SigV4 própria).
const s3on=()=>!!(process.env.S3_ENDPOINT&&process.env.S3_BUCKET&&process.env.S3_KEY&&process.env.S3_SECRET);
const hm=(k,d)=>crypto.createHmac('sha256',k).update(d).digest(),shx=d=>crypto.createHash('sha256').update(d).digest('hex');
async function s3(method,key,body){const ep=new URL(process.env.S3_ENDPOINT),region=process.env.S3_REGION||'auto',pth='/'+process.env.S3_BUCKET+'/'+key.split('/').map(encodeURIComponent).join('/');
 const amz=new Date().toISOString().replace(/[:-]|\.\d{3}/g,''),day=amz.slice(0,8),ph=shx(body||''),sh='host;x-amz-content-sha256;x-amz-date';
 const cr=[method,pth,'','host:'+ep.host+'\nx-amz-content-sha256:'+ph+'\nx-amz-date:'+amz+'\n',sh,ph].join('\n'),sc=day+'/'+region+'/s3/aws4_request',sts=['AWS4-HMAC-SHA256',amz,sc,shx(cr)].join('\n');
 const sig=crypto.createHmac('sha256',hm(hm(hm(hm('AWS4'+process.env.S3_SECRET,day),region),'s3'),'aws4_request')).update(sts).digest('hex');
 const r=await fetch(ep.origin+pth,{method,headers:{'x-amz-date':amz,'x-amz-content-sha256':ph,authorization:'AWS4-HMAC-SHA256 Credential='+process.env.S3_KEY+'/'+sc+', SignedHeaders='+sh+', Signature='+sig},body:body||undefined,signal:AbortSignal.timeout(60000)});
 return{status:r.status,buf:Buffer.from(await r.arrayBuffer())}}
const S3P=(process.env.S3_PREFIX||'abi').replace(/\/+$/,''),S3LATEST=S3P+'/jogo-latest.db.gz';
const DBF=path.resolve(process.env.DB||'jogo.db');
if(process.argv[2]==='--restore'){(async()=>{try{const r=await s3('GET',S3LATEST);if(r.status===200){fs.mkdirSync(path.dirname(DBF),{recursive:true});for(const x of ['','-wal','-shm','-journal'])try{fs.unlinkSync(DBF+x)}catch(e){}fs.writeFileSync(DBF,zlib.gunzipSync(r.buf));console.log('☁️ banco restaurado do backup remoto ('+Math.round(r.buf.length/1024)+' KB)')}else console.log('☁️ sem backup remoto ainda (HTTP '+r.status+')')}catch(e){console.error('☁️ restauração falhou:',e.message)}process.exit(0)})();return}
if(s3on()&&!fs.existsSync(DBF+'.s3ok')){try{require('node:child_process').execFileSync(process.execPath,[__filename,'--restore'],{stdio:'inherit',env:process.env,timeout:120000})}catch(e){console.error('☁️ restauração falhou')}try{fs.mkdirSync(path.dirname(DBF),{recursive:true});fs.writeFileSync(DBF+'.s3ok',String(Date.now()))}catch(e){}}
const PORT=+process.env.PORT||3000,HOST=process.env.HOST||'0.0.0.0',ADMIN=process.env.ADMIN_TOKEN;
// Atrás de proxy/HTTPS (Render, Fly, Railway, Caddy, Nginx): TRUST_PROXY=1 para usar o IP real nos limites de login.
const ipOf=q=>process.env.TRUST_PROXY==='1'?String((q.headers['x-forwarded-for']||'').split(',')[0]||q.socket.remoteAddress).trim():q.socket.remoteAddress;
if(!ADMIN||ADMIN.length<12){console.error('Defina ADMIN_TOKEN com 12+ caracteres.');process.exit(1)}
const db=new DatabaseSync(DBF);
db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT UNIQUE COLLATE NOCASE,salt TEXT,hash TEXT,created INT,banned INT DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(th TEXT PRIMARY KEY,uid INT,created INT);
CREATE TABLE IF NOT EXISTS saves(uid INT PRIMARY KEY,state TEXT,maxLv INT,sumLv INT,chars INT,gold INT,orc INT,stage INT,updated INT);
CREATE TABLE IF NOT EXISTS ids(uid TEXT PRIMARY KEY,owner INT,kind TEXT,gone INT DEFAULT 0,at INT);
CREATE INDEX IF NOT EXISTS ids_owner ON ids(owner);
CREATE TABLE IF NOT EXISTS alerts(id INTEGER PRIMARY KEY,uid INT,msg TEXT,at INT,cleared INT DEFAULT 0);`);
const Q=(s,...a)=>db.prepare(s).all(...a),Q1=(s,...a)=>db.prepare(s).get(...a),X=(s,...a)=>db.prepare(s).run(...a);
const sha=t=>crypto.createHash('sha256').update(t).digest('hex');
const LIM={lvMax:300,lvJump:40,orcJump:5000,charJump:100,minGapMs:5000};
const send=(r,c,o)=>{r.writeHead(c,{'content-type':'application/json'});r.end(JSON.stringify(o))};
const body=req=>new Promise((ok,no)=>{let b='';req.on('data',d=>{b+=d;if(b.length>5e6){no(0);req.destroy()}});req.on('end',()=>{try{ok(JSON.parse(b||'{}'))}catch(e){no(0)}})});
const hit={};const limited=(k,n,ms)=>{const t=Date.now(),a=(hit[k]=(hit[k]||[]).filter(x=>t-x<ms));a.push(t);return a.length>n};
const DEVN=new Set((process.env.DEV_USERS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean));
const user=req=>{const t=(req.headers.authorization||'').replace('Bearer ','');const s=t&&Q1('SELECT uid FROM sessions WHERE th=?',sha(t));const u=s&&Q1('SELECT * FROM users WHERE id=? AND banned=0',s.uid);if(u&&!u.dev&&DEVN.has(String(u.name).toLowerCase())){X('UPDATE users SET dev=1 WHERE id=?',u.id);u.dev=1}return u};
const isAdmin=req=>{const a=Buffer.from(req.headers['x-admin']||''),b=Buffer.from(ADMIN);return a.length===b.length&&crypto.timingSafeEqual(a,b)};
function login(uid){const t=crypto.randomBytes(32).toString('hex');X('INSERT INTO sessions VALUES(?,?,?)',sha(t),uid,Date.now());return t}
function summarize(st){const ch=Array.isArray(st.chars)?st.chars:[];return{maxLv:ch.reduce((m,c)=>Math.max(m,c.lv|0),0),sumLv:ch.reduce((m,c)=>m+(c.lv|0),0),chars:ch.length,gold:st.gold|0,orc:st.orc|0,stage:st.stage|0}}
// ---- Anti-clonagem: cada item/personagem tem um uid. O servidor registra o dono na 1ª vez que vê o uid.
// Se o mesmo uid aparece em outra conta, ou volta depois de ter sumido (save antigo restaurado), é clone: o item é removido do save e vira alerta.
const UID_RE=/^[0-9a-f]{16}$/,ITEM_KEYS=['eqs','runes','pots'];
function collectUids(st){const o=[];ITEM_KEYS.forEach(k=>{(Array.isArray(st[k])?st[k]:[]).forEach(x=>{if(x&&UID_RE.test(x.uid))o.push([x.uid,k])})});(Array.isArray(st.chars)?st.chars:[]).forEach(c=>{if(c&&UID_RE.test(c.uid))o.push([c.uid,'chars'])});return o}
function idGuard(uid,st,prev,now){const cur=collectUids(st),bad=new Set(),msgs=[];
 const dupIn=new Set(),seen=new Set();cur.forEach(([u])=>{if(seen.has(u))dupIn.add(u);seen.add(u)});
 dupIn.forEach(u=>{bad.add(u);msgs.push(`Item duplicado dentro do mesmo save: ${u}`)});
 for(const [u,kind] of cur){if(bad.has(u))continue;const row=Q1('SELECT owner,gone FROM ids WHERE uid=?',u);
  if(!row){X('INSERT INTO ids(uid,owner,kind,at) VALUES(?,?,?,?)',u,uid,kind,now);continue}
  if(row.owner!==uid){const o=Q1('SELECT name FROM users WHERE id=?',row.owner);msgs.push(`CLONE: ${kind} ${u} pertence a "${o?o.name:row.owner}"`);if(kind!=='chars')bad.add(u);continue}
  if(row.gone&&kind!=='chars'){bad.add(u);msgs.push(`CLONE/rollback: ${kind} ${u} já tinha sido gasto/vendido e voltou`)}}
 // itens que existiam no save anterior e sumiram agora: marca como "gone" (não podem voltar)
 if(prev){try{const was=collectUids(JSON.parse(prev.state)),now_=new Set(cur.map(c=>c[0]));was.forEach(([u,k])=>{if(k!=='chars'&&!now_.has(u))X('UPDATE ids SET gone=1 WHERE uid=? AND owner=?',u,uid)})}catch(e){}}
 msgs.slice(0,20).forEach(m=>X('INSERT INTO alerts(uid,msg,at) VALUES(?,?,?)',uid,m,now));
 if(bad.size){ITEM_KEYS.forEach(k=>{if(Array.isArray(st[k]))st[k]=st[k].filter(x=>!(x&&bad.has(x.uid)))})}
 return[...bad]}
db.exec('CREATE TABLE IF NOT EXISTS announces(id INTEGER PRIMARY KEY,uid INT,name TEXT,txt TEXT,k TEXT,at INT)');
try{db.exec('ALTER TABLE users ADD COLUMN locked INT DEFAULT 0')}catch(e){}try{db.exec('ALTER TABLE users ADD COLUMN dev INT DEFAULT 0')}catch(e){}
LIM.sumJump=1000;
// Carteira protegida: diamantes/oricalco só podem subir até um teto por envio, por tempo e por dia (ajuste por env se precisar).
Object.assign(LIM,{diaPush:+process.env.DIA_PUSH||5000,diaRate:+process.env.DIA_RATE||20,diaDay:+process.env.DIA_DAY||60000,orcPush:+process.env.ORC_PUSH||300,orcRate:+process.env.ORC_RATE||2,orcDay:+process.env.ORC_DAY||3000,histKeep:30,histGap:6e5});
db.exec(`CREATE TABLE IF NOT EXISTS hist(id INTEGER PRIMARY KEY,uid INT,at INT,state TEXT);
CREATE INDEX IF NOT EXISTS hist_uid ON hist(uid);
CREATE TABLE IF NOT EXISTS wday(uid INT,day INT,dia INT DEFAULT 0,orc INT DEFAULT 0,PRIMARY KEY(uid,day));
CREATE TABLE IF NOT EXISTS credits(id INTEGER PRIMARY KEY,uid INT,dia INT,orc INT,note TEXT,at INT,applied INT DEFAULT 0);`);
try{db.exec('ALTER TABLE saves ADD COLUMN dia INT DEFAULT 0')}catch(e){}
try{db.exec('ALTER TABLE saves ADD COLUMN prof TEXT')}catch(e){}try{db.exec('ALTER TABLE saves ADD COLUMN plv INT DEFAULT 0')}catch(e){}
db.exec('CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY,v TEXT)');db.exec('CREATE TABLE IF NOT EXISTS devops(id INTEGER PRIMARY KEY,uid INT,op TEXT,at INT,done INT DEFAULT 0)');
try{db.exec('ALTER TABLE users ADD COLUMN ep INT DEFAULT 0')}catch(e){}
for(const c of ['gsub TEXT','email TEXT','tsalt TEXT','thash TEXT','texp INT DEFAULT 0','gexp INT DEFAULT 0'])try{db.exec('ALTER TABLE users ADD COLUMN '+c)}catch(e){}
try{db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_gsub ON users(gsub) WHERE gsub IS NOT NULL')}catch(e){}
try{db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(lower(email)) WHERE email IS NOT NULL')}catch(e){}
(process.env.DEV_USERS||'').split(',').map(x=>x.trim()).filter(Boolean).forEach(n=>{try{X('UPDATE users SET dev=1 WHERE name=? OR lower(email)=lower(?)',n,n)}catch(e){}});
const getEpoch=()=>(Q1("SELECT v FROM meta WHERE k='epoch'")||{v:'0'}).v;
const epochOf=u=>getEpoch()+(u&&u.ep?'.'+u.ep:'');
db.exec('CREATE TABLE IF NOT EXISTS profiles(uid INTEGER PRIMARY KEY,pn TEXT,av TEXT,bn TEXT,vip INT DEFAULT 0)');try{db.exec('ALTER TABLE profiles ADD COLUMN tt INT DEFAULT -1')}catch(e){}try{db.exec('ALTER TABLE profiles ADD COLUMN alv INT DEFAULT 0')}catch(e){}try{db.exec('ALTER TABLE profiles ADD COLUMN fw INT DEFAULT 4')}catch(e){}['nc','fc','ff','fg','fs','fi','fc2','fc3','fm'].forEach(c=>{try{db.exec('ALTER TABLE profiles ADD COLUMN '+c+' TEXT')}catch(e){}});const FG_OK=new Set(['on','anim','off']),FS_OK=new Set(['solid','double','dotted','dashed','ridge']),FI_RE=/^data:image\/(png|webp|gif);base64,[A-Za-z0-9+\/=]+$/,FF_OK=new Set(['impact','comic','mono','script','serif']),COL_RE=/^#[0-9a-fA-F]{6}$/;
const IMG_RE=/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+\/=]+$/;
function saveProfile(uid,st,now){const pn=String(st.pn||'').replace(/[<>&"]/g,'').slice(0,20),av=typeof st.av==='string'&&st.av.length<160000&&IMG_RE.test(st.av)?st.av:'',bn=typeof st.bn==='string'&&st.bn.length<120000&&IMG_RE.test(st.bn)?st.bn:'',vip=(+st.vip||0)>now?1:0;
 const nc=vip&&COL_RE.test(st.pnc||'')?st.pnc:'',fc=vip&&COL_RE.test(st.pfc||'')?st.pfc:'',ff=vip&&FF_OK.has(st.pff)?st.pff:'';const fg=vip&&FG_OK.has(st.pfg)?st.pfg:'',fs=vip&&FS_OK.has(st.pfs)?st.pfs:'',fw=vip?Math.max(2,Math.min(8,Math.round(+st.pfw)||4)):4,fi=vip&&typeof st.pfi==='string'&&st.pfi.length<150000&&FI_RE.test(st.pfi)?st.pfi:'';const fc2=vip&&COL_RE.test(st.pfc2||'')?st.pfc2:'',fc3=vip&&COL_RE.test(st.pfc3||'')?st.pfc3:'',fm=vip&&(st.pfm==='tri'||st.pfm==='rgb')?st.pfm:'';const alv=Number.isInteger(st.alv)&&st.alv>=0&&st.alv<100000?st.alv:0,tt=Number.isInteger(st.tte)&&st.tte>=0&&st.tte<1000?st.tte:-1,pn2=pn||null;const o=Q1('SELECT pn,vip,tt,alv,nc,fc,ff,fc2,fc3,fm,fg,fs,fw,length(fi) lf,length(av) la,length(bn) lb FROM profiles WHERE uid=?',uid);if(o&&o.pn===pn2&&o.vip===vip&&o.tt===tt&&(o.alv|0)===alv&&(o.nc||'')===nc&&(o.fc||'')===fc&&(o.ff||'')===ff&&(o.fg||'')===fg&&(o.fc2||'')===fc2&&(o.fc3||'')===fc3&&(o.fm||'')===fm&&(o.fs||'')===fs&&(o.fw|0)===fw&&(o.lf|0)===fi.length&&(o.la|0)===av.length&&(o.lb|0)===bn.length)return;
 X('INSERT OR REPLACE INTO profiles(uid,pn,av,bn,vip,tt,alv,nc,fc,ff,fg,fs,fw,fi,fc2,fc3,fm) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',uid,pn2,av,bn,vip,tt,alv,nc,fc,ff,fg,fs,fw,fi,fc2,fc3,fm)}
function applyCredits(uid,st){const cs=Q('SELECT * FROM credits WHERE uid=? AND applied=0',uid);if(!cs.length)return false;
 cs.forEach(c=>{st.dia=Math.max(0,(st.dia|0)+(c.dia|0));st.orc=Math.max(0,(st.orc|0)+(c.orc|0));X('UPDATE credits SET applied=1 WHERE id=?',c.id)});return true}
function walletGuard(uid,st,prev,now){let pv=null;try{pv=prev&&JSON.parse(prev.state)}catch(e){}if(!pv)return false;
 const day=Math.floor(now/864e5);X('INSERT OR IGNORE INTO wday(uid,day) VALUES(?,?)',uid,day);const row=Q1('SELECT * FROM wday WHERE uid=? AND day=?',uid,day);let cut=false;
 [['dia',LIM.diaPush,LIM.diaRate,LIM.diaDay],['orc',LIM.orcPush,LIM.orcRate,LIM.orcDay]].forEach(([k,push,rate,cap])=>{
  const cur=st[k]|0,old=pv[k]|0,d=cur-old;if(d<=0)return;
  const sec=Math.min(3600,Math.max(0,(now-prev.updated)/1000));const allow=Math.max(0,Math.min(push+rate*sec,cap-row[k]));
  if(d>allow){st[k]=old+Math.floor(allow);cut=true;X('INSERT INTO alerts(uid,msg,at) VALUES(?,?,?)',uid,`💎 Carteira: ${k==='dia'?'diamantes':'oricalco'} +${d} em ${Math.round(sec)}s (permitido ${Math.floor(allow)}) — cortado`,now)}
  X(`UPDATE wday SET ${k}=${k}+? WHERE uid=? AND day=?`,Math.min(d,Math.floor(allow)),uid,day)});
 return cut}
function snap(uid,st,now){const l=Q1('SELECT at FROM hist WHERE uid=? ORDER BY id DESC LIMIT 1',uid);if(l&&now-l.at<LIM.histGap)return;
 X('INSERT INTO hist(uid,at,state) VALUES(?,?,?)',uid,now,JSON.stringify(st));X('DELETE FROM hist WHERE uid=? AND id NOT IN (SELECT id FROM hist WHERE uid=? ORDER BY id DESC LIMIT ?)',uid,uid,LIM.histKeep)}
function check(uid,s,prev,now){const n=[];
if(s.maxLv>LIM.lvMax)n.push(`Personagem com nível ${s.maxLv} (limite ${LIM.lvMax})`);
if(prev&&now-prev.updated<600000){if(s.maxLv-prev.maxLv>=LIM.lvJump)n.push(`Nível máximo ${prev.maxLv}→${s.maxLv} em ${Math.round((now-prev.updated)/1000)}s`);
if(s.orc-prev.orc>=LIM.orcJump)n.push(`Oricalco +${s.orc-prev.orc}`);if(s.chars-prev.chars>=LIM.charJump)n.push(`+${s.chars-prev.chars} personagens de uma vez`)}
let lock=false;if(prev&&now-prev.updated<600000&&s.sumLv-prev.sumLv>=LIM.sumJump){lock=true;n.push(`🔒 CONTA BLOQUEADA: +${s.sumLv-prev.sumLv} níveis somados em ${Math.round((now-prev.updated)/1000)}s`)}
n.forEach(m=>X('INSERT INTO alerts(uid,msg,at) VALUES(?,?,?)',uid,m,now));return lock}

// ================= SALAS EM TEMPO REAL (lobby, chat, casas) — SSE, sem dependências =================
// Cliente abre GET /api/rt?room=lobby3 (fluxo SSE, com Authorization) e envia POST /api/rt/send.
const ROOMS=new Map(),RTM={max:+process.env.ROOM_MAX||120,perUser:3,flushMs:400};let peerSeq=0;
const ROOM_RE=/^(lobby\d{1,2}|home[\w:]{1,16})$/,EV_OK=new Set(['chat','knock','knockr','hbuy','hbuyr']);
const sseW=(res,ev,d)=>{try{res.write('event: '+ev+'\ndata: '+JSON.stringify(d)+'\n\n')}catch(e){}};
function rtFlush(rm){rm.timer=null;if(!rm.peers.size){ROOMS.delete(rm.n);return}
 const u=[...rm.dirty].map(id=>rm.peers.get(id)).filter(Boolean).map(p=>({peer:p.id,presence:p.presence,kind:'viewer'})),d=[...rm.gone];rm.dirty.clear();rm.gone.length=0;
 if(!u.length&&!d.length)return;for(const p of rm.peers.values())sseW(p.res,'pp',{u,d})}
function rtMark(rm,id,gone){if(gone){rm.gone.push(id);rm.dirty.delete(id)}else rm.dirty.add(id);if(!rm.timer)rm.timer=setTimeout(()=>rtFlush(rm),RTM.flushMs)}
function rtDrop(rm,p){if(!rm.peers.delete(p.id))return;clearInterval(p.hb);try{p.res.end()}catch(e){}rtMark(rm,p.id,1)}
const rtBucket=(p,n,ms)=>{const t=Date.now();p.rl=(p.rl||{});const a=(p.rl[n]=(p.rl[n]||[]).filter(x=>t-x<ms));a.push(t);return a.length};
const rtRoutes={
 'GET /api/rt'(q,r,url){const u=user(q);if(!u)return send(r,401,{});const room=String(url.searchParams.get('room')||'');if(!ROOM_RE.test(room))return send(r,400,{error:'sala inválida'});
  let rm=ROOMS.get(room);if(!rm){rm={n:room,peers:new Map(),dirty:new Set(),gone:[],timer:null};ROOMS.set(room,rm)}
  if(rm.peers.size>=RTM.max)return send(r,503,{error:'sala cheia'});
  // no máximo 3 conexões por conta no total (a mais antiga cai)
  const mine=[];for(const x of ROOMS.values())for(const p of x.peers.values())if(p.uid===u.id)mine.push([x,p]);while(mine.length>=RTM.perUser){const[x,p]=mine.shift();rtDrop(x,p)}
  r.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','x-accel-buffering':'no',connection:'keep-alive'});r.socket.setNoDelay(true);r.socket.setTimeout(0);
  const id='p'+(++peerSeq)+crypto.randomBytes(3).toString('hex'),p={id,uid:u.id,name:u.name,res:r,presence:null,rl:{}};rm.peers.set(id,p);
  p.hb=setInterval(()=>{try{r.write(': ping\n\n')}catch(e){}},15000);
  sseW(r,'hello',{peer:id,uid:'u'+u.id,name:u.name,dev:!!u.dev});
  sseW(r,'pp',{u:[...rm.peers.values()].filter(x=>x.id!==id||1).map(x=>({peer:x.id,presence:x.presence,kind:'viewer'})),d:[]});
  rtMark(rm,id,0);q.on('close',()=>rtDrop(rm,p))},
 async 'POST /api/rt/send'(q,r){const u=user(q);if(!u)return send(r,401,{});const b=await body(q),rm=ROOMS.get(String(b.room||'')),p=rm&&rm.peers.get(String(b.peer||''));
  if(!p||p.uid!==u.id)return send(r,404,{error:'sala/peer desconhecido'});
  if(b.t==='presence'){if(rtBucket(p,'pr',1000)>6)return send(r,429,{});const j=JSON.stringify(b.presence==null?null:b.presence);if(j.length>6000)return send(r,413,{});p.presence=b.presence==null?null:JSON.parse(j);rtMark(rm,p.id,0);return send(r,200,{ok:1})}
  if(b.t==='leave'){rtDrop(rm,p);return send(r,200,{ok:1})}
  if(b.t==='emit'){const type=String(b.type||'');if(!EV_OK.has(type))return send(r,400,{});if(rtBucket(p,'em',1000)>(type==='chat'?2:8))return send(r,429,{});
   const j=JSON.stringify(b.data==null?{}:b.data);if(j.length>2000)return send(r,413,{});const data=JSON.parse(j);if(type==='chat'&&data&&typeof data==='object')data.n=String(data.n||u.name).slice(0,24);
   for(const x of rm.peers.values())sseW(x.res,'ev',{type,data,peer:p.id});return send(r,200,{ok:1})}
  send(r,400,{})},
 'GET /api/boards'(q,r){const u=user(q);if(!u)return send(r,401,{});
  const rows=Q(`SELECT COALESCE(p.pn,u.name) n,u.id id,COALESCE(json_extract(s.state,'$.pdl'),0) pdl,COALESCE(json_extract(s.state,'$.pdlE'),0) pe,COALESCE(json_extract(s.state,'$.phs'),0) phs,COALESCE(json_extract(s.state,'$.x1.k'),0) k,COALESCE(json_extract(s.state,'$.x1.d'),0) d FROM saves s JOIN users u ON u.id=s.uid LEFT JOIN profiles p ON p.uid=u.id WHERE u.banned=0 ORDER BY s.updated DESC LIMIT 2000`);
  const top=(f,n)=>rows.filter(x=>f(x)>0).sort((a,b)=>f(b)-f(a)).slice(0,n),m=x=>x.id===u.id;
  send(r,200,{pdl:top(x=>x.pdl|0,100).map(x=>({n:x.n,v:x.pdl|0,me:m(x)})),pve:top(x=>(x.phs|0)||(x.pe|0),100).map(x=>({n:x.n,p:x.pe|0,v:x.phs|0,me:m(x)})),x1:top(x=>x.k|0,100).map(x=>({n:x.n,k:x.k|0,d:x.d|0,me:m(x)}))})},
 async 'POST /api/forgot'(q,r){const b=await body(q);const id=String(b.id||b.email||b.user||'').trim().slice(0,200);const ok=()=>send(r,200,{ok:1,msg:'Se a conta existir, enviamos uma senha nova para o e-mail cadastrado. Confira também o spam.'});
  if(!id)return send(r,400,{error:'Digite seu e-mail ou usuário.'});if(!mailOn())return send(r,503,{error:'Recuperação por e-mail ainda não está configurada neste servidor.'});
  if(limited('fg'+ipOf(q),5,3600e3)||limited('fgi'+id.toLowerCase(),3,3600e3))return send(r,429,{error:'Muitos pedidos. Tente de novo em 1 hora.'});
  const u=Q1('SELECT * FROM users WHERE banned=0 AND (lower(email)=? OR name=?)',id.toLowerCase(),id);if(!u||!u.email)return ok();
  const pw=genPass(),salt=crypto.randomBytes(16).toString('hex');X('UPDATE users SET tsalt=?,thash=?,texp=? WHERE id=?',salt,crypto.scryptSync(pw,salt,64).toString('hex'),Date.now()+30*60e3,u.id);
  try{await sendMail(u.email,'Sua senha temporária - Adventure Brazilian IDLE',`Olá, ${u.name}!\n\nUsuário: ${u.name}\nSenha temporária: ${pw}\n\nEla vale por 30 minutos e passa a ser a sua senha assim que você entrar. Sua senha antiga continua funcionando até lá.\nSe não foi você que pediu, ignore este e-mail.\n`)}catch(e){console.error('e-mail falhou:',e.message);return send(r,502,{error:'Não consegui enviar o e-mail agora. Tente mais tarde.'})}
  ok()},
 async 'POST /api/email'(q,r){const u=user(q);if(!u)return send(r,401,{});const b=await body(q),em=String(b.email||'').trim().toLowerCase();if(!EMAIL_RE.test(em))return send(r,400,{error:'E-mail inválido.'});
  if(u.email&&!pwOk(u,b.pass))return send(r,403,{error:'Senha atual incorreta.'});if(Q1('SELECT 1 FROM users WHERE lower(email)=? AND id<>?',em,u.id))return send(r,409,{error:'Este e-mail já está em uso.'});
  X('UPDATE users SET email=? WHERE id=?',em,u.id);send(r,200,{ok:1})},
 'GET /api/config'(q,r){send(r,200,{google:process.env.GOOGLE_CLIENT_ID||null,mail:mailOn()})},
 async 'POST /api/google'(q,r){const CID=process.env.GOOGLE_CLIENT_ID;if(!CID)return send(r,503,{error:'Login com Google não está configurado.'});
  if(limited('gg'+ipOf(q),30,600e3))return send(r,429,{error:'Muitas tentativas.'});const b=await body(q),cred=String(b.credential||'');if(cred.length<100||cred.length>5000)return send(r,400,{error:'Credencial inválida.'});
  let t;try{const x=await fetch((process.env.GOOGLE_TOKENINFO_URL||'https://oauth2.googleapis.com/tokeninfo')+'?id_token='+encodeURIComponent(cred),{signal:AbortSignal.timeout(10000)});if(!x.ok)return send(r,401,{error:'Google recusou o login.'});t=await x.json()}catch(e){return send(r,502,{error:'Não consegui falar com o Google.'})}
  if(t.aud!==CID||!/^(https:\/\/)?accounts\.google\.com$/.test(String(t.iss||''))||String(t.email_verified)!=='true'||!t.sub||!t.email||+t.exp*1000<Date.now())return send(r,401,{error:'Login do Google inválido.'});
  const em=String(t.email).toLowerCase();let u=Q1('SELECT * FROM users WHERE gsub=?',t.sub)||Q1('SELECT * FROM users WHERE lower(email)=?',em);
  if(u){if(u.banned)return send(r,403,{error:'Conta bloqueada.'});if(!u.gsub)X('UPDATE users SET gsub=? WHERE id=?',t.sub,u.id);return send(r,200,{token:login(u.id),user:u.name})}
  let base=String(t.name||em.split('@')[0]).normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^\w.-]+/g,'').slice(0,14)||'jogador',n=base;for(let i=0;i<50&&(n.length<3||Q1('SELECT 1 FROM users WHERE name=?',n));i++)n=base+Math.floor(Math.random()*9000+1000);
  const salt=crypto.randomBytes(16).toString('hex'),hash=crypto.scryptSync(crypto.randomBytes(24).toString('hex'),salt,64).toString('hex');
  const id=X('INSERT INTO users(name,salt,hash,created,email,gsub) VALUES(?,?,?,?,?,?)',n,salt,hash,Date.now(),em,t.sub).lastInsertRowid;send(r,200,{token:login(id),user:n,novo:1})},
 async 'POST /api/devcmd'(q,r){const u=user(q);if(!u||!u.dev)return send(r,403,{error:'Só conta DEV.'});const b=await body(q);const cmd=String(b.cmd||'').toLowerCase(),qtd=Math.trunc(+b.qtd||0),arg=Math.trunc(+b.arg||0);let a=String(b.alvo||'').trim().slice(0,200);
  if(!['diamantes','oricalco','levelup','gold','bau','personagem'].includes(cmd)||!qtd)return send(r,400,{error:'Comando inválido.'});
  const lim={diamantes:1e7,oricalco:1e6,levelup:300,gold:1e13,bau:1e6,personagem:50}[cmd];if(Math.abs(qtd)>lim||(['levelup','personagem'].includes(cmd)&&qtd<1))return send(r,400,{error:'Valor fora do limite (máx '+lim+').'});
  if((cmd==='bau'||cmd==='personagem')&&(arg<0||arg>5))return send(r,400,{error:'Opção inválida.'});
  let t;if(!a)t={id:u.id,name:u.name};else{const m=/^(?:id\s*[-:#]?\s*|#)?(\d{1,9})$/i.exec(a);t=m?Q1('SELECT id,name FROM users WHERE id=?',+m[1]):null;
  if(!t)t=Q1('SELECT id,name FROM users WHERE lower(email)=?',a.toLowerCase());if(!t)t=Q1('SELECT id,name FROM users WHERE name=?',a)}
  if(!t)return send(r,404,{error:'Conta não encontrada: '+a.replace(/[<>&]/g,'')});
  const note='dev '+u.name+' (chat) '+cmd;
  if(cmd==='diamantes'||cmd==='oricalco')X('INSERT INTO credits(uid,dia,orc,note,at) VALUES(?,?,?,?,?)',t.id,cmd==='diamantes'?qtd:0,cmd==='oricalco'?qtd:0,note,Date.now());
  else{const op=cmd==='levelup'?{t:'lv',n:qtd}:cmd==='gold'?{t:'gold',n:qtd}:cmd==='bau'?{t:'bau',d:arg,n:qtd}:{t:'pj',r:arg,n:qtd};X('INSERT INTO devops(uid,op,at) VALUES(?,?,?)',t.id,JSON.stringify(op),Date.now());}
  send(r,200,{ok:1,id:t.id,name:t.name})},
 async 'GET /api/ops'(q,r){const u=user(q);if(!u)return send(r,401,{});const rows=Q('SELECT id,op FROM devops WHERE uid=? AND done=0 ORDER BY id LIMIT 50',u.id);const ops=[];rows.forEach(w=>{try{ops.push(JSON.parse(w.op))}catch(e){}X('UPDATE devops SET done=1 WHERE id=?',w.id)});if(ops.length)X('UPDATE users SET gexp=? WHERE id=?',Date.now()+180000,u.id);send(r,200,{ops})},
 'GET /api/me'(q,r){const u=user(q);if(!u)return send(r,401,{});send(r,200,{id:'u'+u.id,uid:u.id,name:u.name,dev:!!u.dev,hasEmail:!!u.email})},
 'GET /healthz'(q,r){try{Q1('SELECT 1 x');send(r,200,{ok:1,persist:DBD.persist,s3:{on:S3S.on,ultimoBackup:S3S.ok?new Date(S3S.ok).toISOString():null,backups:S3S.n,erro:S3S.err||null},db:DBD.file,mount:DBD.mount,fstype:DBD.fstype,users:(Q1('SELECT COUNT(*) n FROM users')||{}).n,rooms:ROOMS.size,peers:[...ROOMS.values()].reduce((n,x)=>n+x.peers.size,0)})}catch(e){send(r,500,{ok:0})}}};

// ================= E-MAIL (cadastro / "esqueci a senha") =================
// Opção A (mais simples): RESEND_API_KEY + MAIL_FROM  (resend.com, plano grátis)
// Opção B: SMTP com TLS direto (porta 465): SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM  (Gmail com "senha de app", Brevo, Zoho…)
const tlsM=require('node:tls');
const MAIL_FROM=process.env.MAIL_FROM||process.env.SMTP_USER||'';
const mailOn=()=>!!(process.env.RESEND_API_KEY&&MAIL_FROM)||!!(process.env.SMTP_HOST&&process.env.SMTP_USER&&process.env.SMTP_PASS);
const EMAIL_RE=/^[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]{1,190}\.[A-Za-z]{2,24}$/;
const B64=t=>Buffer.from(t,'utf8').toString('base64'),mimeSubj=t=>'=?UTF-8?B?'+B64(t)+'?=';
const fromAddr=()=>(MAIL_FROM.match(/<([^>]+)>/)||[0,MAIL_FROM])[1].trim();
async function sendMail(to,subject,text){
 if(process.env.RESEND_API_KEY&&MAIL_FROM){const r=await fetch(process.env.RESEND_URL||'https://api.resend.com/emails',{method:'POST',headers:{authorization:'Bearer '+process.env.RESEND_API_KEY,'content-type':'application/json'},body:JSON.stringify({from:MAIL_FROM,to:[to],subject,text})});if(!r.ok)throw new Error('resend '+r.status+' '+(await r.text()).slice(0,200));return}
 const host=process.env.SMTP_HOST,port=+process.env.SMTP_PORT||465;
 await new Promise((ok,no)=>{const s=tlsM.connect({host,port,servername:host,rejectUnauthorized:process.env.SMTP_INSECURE!=='1'});s.setTimeout(20000,()=>{s.destroy();no(new Error('smtp timeout'))});s.on('error',no);
  let buf='',wake=null;s.on('data',d=>{buf+=d;if(wake)wake()});
  const read=()=>new Promise(res=>{const chk=()=>{const L=buf.split('\r\n');if(L.length>1&&/^\d{3} /.test(L[L.length-2]||'')){const c=+L[L.length-2].slice(0,3);buf='';wake=null;res(c)}};wake=chk;chk()});
  const cmd=async(l,exp)=>{if(l!==null)s.write(l+'\r\n');const c=await read();if(c!==exp)throw new Error('smtp '+c+' após '+String(l).slice(0,12))};
  (async()=>{await cmd(null,220);await cmd('EHLO jogo',250);await cmd('AUTH LOGIN',334);await cmd(B64(process.env.SMTP_USER),334);await cmd(B64(process.env.SMTP_PASS),235);
   await cmd('MAIL FROM:<'+fromAddr()+'>',250);await cmd('RCPT TO:<'+to+'>',250);await cmd('DATA',354);
   const msg=['From: '+MAIL_FROM,'To: '+to,'Subject: '+mimeSubj(subject),'Date: '+new Date().toUTCString(),'MIME-Version: 1.0','Content-Type: text/plain; charset=utf-8','Content-Transfer-Encoding: base64','',(B64(text).match(/.{1,76}/g)||[]).join('\r\n'),'.'].join('\r\n');
   await cmd(msg,250);s.write('QUIT\r\n');s.end();ok()})().catch(e=>{try{s.destroy()}catch(x){}no(e)})})}
const PW_ALPHA='abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genPass=()=>Array.from(crypto.randomBytes(10),b=>PW_ALPHA[b%PW_ALPHA.length]).join('');
const pwOk=(u,p)=>{const h=crypto.scryptSync(String(p||''),u.salt,64),g=Buffer.from(u.hash,'hex');return h.length===g.length&&crypto.timingSafeEqual(h,g)};
const tmpOk=(u,p)=>{if(!u.thash||!(u.texp>Date.now()))return false;const h=crypto.scryptSync(String(p||''),u.tsalt,64),g=Buffer.from(u.thash,'hex');return h.length===g.length&&crypto.timingSafeEqual(h,g)};
// Descobre se o banco está em disco persistente (volume montado) ou no disco temporário do container.
function dbDisk(){try{const f=path.resolve(process.env.DB||'jogo.db');let best=null;for(const l of fs.readFileSync('/proc/mounts','utf8').split('\n')){const a=l.split(' ');if(a.length<3)continue;const mp=a[1].replace(/\\040/g,' ');if((f===mp||f.startsWith(mp==='/'?'/':mp+'/'))&&(!best||mp.length>best.mp.length))best={mp,fs:a[2],dev:a[0]}}
 const temp=!best||best.mp==='/'||['overlay','tmpfs','aufs','squashfs'].includes(best.fs);return{file:f,mount:best?best.mp:'?',fstype:best?best.fs:'?',persist:!temp}}catch(e){return{file:path.resolve(process.env.DB||'jogo.db'),persist:null}}}
const DBD=dbDisk();
const routes={
...rtRoutes,
async 'POST /api/register'(q,r){const b=await body(q);const n=String(b.user||'').trim(),p=String(b.pass||'');
 if(!/^[\w.-]{3,20}$/.test(n)||p.length<8||p.length>100)return send(r,400,{error:'Usuário 3-20 letras/números e senha com 8+ caracteres.'});
 const em=String(b.email||'').trim().toLowerCase();if(process.env.REQUIRE_EMAIL!=='0'&&!EMAIL_RE.test(em))return send(r,400,{error:'Informe um e-mail válido.'});if(em&&!EMAIL_RE.test(em))return send(r,400,{error:'E-mail inválido.'});
 if(limited('reg'+ipOf(q),5,3600e3))return send(r,429,{error:'Muitas contas criadas, tente mais tarde.'});
 if(em&&Q1('SELECT 1 FROM users WHERE lower(email)=?',em))return send(r,409,{error:'Este e-mail já está em uso.'});
 if(Q1('SELECT 1 FROM users WHERE name=?',n))return send(r,409,{error:'Usuário já existe.'});
 const salt=crypto.randomBytes(16).toString('hex'),hash=crypto.scryptSync(p,salt,64).toString('hex');
 const id=X('INSERT INTO users(name,salt,hash,created,email) VALUES(?,?,?,?,?)',n,salt,hash,Date.now(),em||null).lastInsertRowid;send(r,200,{token:login(id),user:n})},
async 'POST /api/login'(q,r){const b=await body(q);if(limited('lg'+ipOf(q),10,600e3))return send(r,429,{error:'Muitas tentativas.'});
 const u=Q1('SELECT * FROM users WHERE name=? AND banned=0',String(b.user||''));
 let okp=u&&pwOk(u,b.pass);if(u&&!okp&&tmpOk(u,b.pass)){okp=true;X('UPDATE users SET salt=?,hash=?,thash=NULL,tsalt=NULL,texp=0 WHERE id=?',u.tsalt,u.thash,u.id)}
 if(!u||!okp)return send(r,401,{error:'Usuário ou senha inválidos.'});send(r,200,{token:login(u.id),user:u.name})},
async 'GET /api/save'(q,r){const u=user(q);if(!u)return send(r,401,{});const s=Q1('SELECT state FROM saves WHERE uid=?',u.id);const st=s?JSON.parse(s.state):null;if(st&&applyCredits(u.id,st)){X('UPDATE saves SET state=?,orc=?,dia=? WHERE uid=?',JSON.stringify(st),st.orc|0,st.dia|0,u.id)}send(r,200,{state:st,epoch:epochOf(u),dev:u.dev?1:0,locked:u.locked&&!u.dev?1:0})},
async 'PUT /api/save'(q,r){const u=user(q);if(!u)return send(r,401,{});if(u.locked&&!u.dev)return send(r,423,{locked:1});const ep0=epochOf(u);if(!(getEpoch()==='0'&&!u.ep)&&String(q.headers['x-epoch']||'')!==ep0)return send(r,409,{reset:1,epoch:ep0});const b=await body(q);const st=b.state;
 if(!st||typeof st!=='object')return send(r,400,{});const prev=Q1('SELECT * FROM saves WHERE uid=?',u.id),now=Date.now();
 if(prev&&now-prev.updated<LIM.minGapMs)return send(r,429,{error:'Devagar.'});
 const strip=idGuard(u.id,st,prev,now);const s=summarize(st);const lk=((u.gexp|0)>now)?(check(u.id,{...s,maxLv:0,sumLv:0,chars:0,orc:0},prev&&{...prev,maxLv:0,sumLv:0,chars:0,orc:0},now),false):check(u.id,s,prev,now);if(!u.dev&&(lk||st.lock)){X('UPDATE users SET locked=1 WHERE id=?',u.id);return send(r,423,{locked:1})}
 if(!u.dev){st.profLock=true;try{const pv0=prev&&JSON.parse(prev.state);if(pv0&&pv0.prof&&st.prof!==pv0.prof)st.prof=pv0.prof}catch(e){}}
 const cut=u.dev?false:walletGuard(u.id,st,prev,now);const cr=applyCredits(u.id,st);const s2=summarize(st);
 X('INSERT OR REPLACE INTO saves(uid,state,maxLv,sumLv,chars,gold,orc,stage,updated,dia) VALUES(?,?,?,?,?,?,?,?,?,?)',u.id,JSON.stringify(st),s2.maxLv,s2.sumLv,s2.chars,s2.gold,s2.orc,s2.stage,now,st.dia|0);{const pr=['Ferreiro','Joalheiro','Alquimista'].includes(st.prof)?st.prof:null;X('UPDATE saves SET prof=?,plv=? WHERE uid=?',pr,pr?Math.floor((((st.pxp||{})[pr])|0)/10):0,u.id)}snap(u.id,st,now);try{saveProfile(u.id,st,now)}catch(e){}
 send(r,200,{ok:1,strip,wallet:(cut||cr)?{dia:st.dia|0,orc:st.orc|0}:undefined})},
async 'POST /api/announce'(q,r){const u=user(q);if(!u)return send(r,401,{});const b=await body(q);const now=Date.now(),last=Q1('SELECT at FROM announces WHERE uid=? ORDER BY id DESC LIMIT 1',u.id);if(last&&now-last.at<3000)return send(r,429,{});const txt=String(b.txt||'').replace(/[<>&]/g,'').slice(0,160),k=['dv','rf','mt'].includes(b.k)?b.k:'dv';if(!txt)return send(r,400,{});X('INSERT INTO announces(uid,name,txt,k,at) VALUES(?,?,?,?,?)',u.id,u.name,txt,k,now);send(r,200,{ok:1})},
async 'GET /api/announces'(q,r){const u=user(q);if(!u)return send(r,401,{});const url=new URL(q.url,'http://x'),since=+url.searchParams.get('since')||0;const rows=Q('SELECT id,uid,name,txt,k FROM announces WHERE id>? AND at>? ORDER BY id LIMIT 20',since,Date.now()-120000);send(r,200,{rows:rows.filter(x=>x.uid!==u.id),last:Q1('SELECT MAX(id) m FROM announces').m||0})},
async 'GET /api/ranking'(q,r){send(r,200,Q('SELECT u.name,s.maxLv,s.stage,s.chars FROM saves s JOIN users u ON u.id=s.uid WHERE u.banned=0 ORDER BY s.maxLv DESC LIMIT 100'))},
// ---- admin (header x-admin). Nunca devolve senha: só existe hash+salt no banco.
async 'GET /api/admin/users'(q,r){if(!isAdmin(q))return send(r,403,{});send(r,200,Q('SELECT u.id,u.name,u.created,u.banned,u.locked,u.dev,s.maxLv,s.chars,s.gold,s.orc,s.stage,s.updated FROM users u LEFT JOIN saves s ON s.uid=u.id ORDER BY s.maxLv DESC'))},
async 'GET /api/admin/inventory'(q,r,url){if(!isAdmin(q))return send(r,403,{});const s=Q1('SELECT state FROM saves WHERE uid=?',+url.searchParams.get('id'));send(r,200,s?JSON.parse(s.state):null)},
async 'GET /api/admin/item'(q,r,url){if(!isAdmin(q))return send(r,403,{});const x=String(url.searchParams.get('uid')||'').toLowerCase().replace(/^\s*id[-\s]?/,'').replace(/[^0-9a-f]/g,'');const row=Q1('SELECT i.*,u.name FROM ids i LEFT JOIN users u ON u.id=i.owner WHERE i.uid=?',x);send(r,200,row||{error:'ID não encontrado'})},
async 'GET /api/admin/alerts'(q,r){if(!isAdmin(q))return send(r,403,{});send(r,200,Q('SELECT a.id,a.msg,a.at,u.name,u.id uid FROM alerts a JOIN users u ON u.id=a.uid WHERE a.cleared=0 ORDER BY a.at DESC LIMIT 200'))},
async 'POST /api/admin/clear'(q,r){if(!isAdmin(q))return send(r,403,{});const b=await body(q);X('UPDATE alerts SET cleared=1 WHERE id=?',+b.id);send(r,200,{ok:1})},
async 'POST /api/admin/unlock'(q,r){if(!isAdmin(q))return send(r,403,{});const b=await body(q);X('UPDATE users SET locked=0 WHERE id=?',+b.id);const s=Q1('SELECT state FROM saves WHERE uid=?',+b.id);if(s){const st=JSON.parse(s.state);delete st.lock;X('UPDATE saves SET state=? WHERE uid=?',JSON.stringify(st),+b.id)}send(r,200,{ok:1})},
async 'POST /api/admin/dev'(q,r){if(!isAdmin(q))return send(r,403,{});const b=await body(q);X('UPDATE users SET dev=? WHERE id=?',b.dev?1:0,+b.id);send(r,200,{ok:1})},
async 'POST /api/admin/ban'(q,r){if(!isAdmin(q))return send(r,403,{});const b=await body(q);X('UPDATE users SET banned=? WHERE id=?',b.ban?1:0,+b.id);if(b.ban)X('DELETE FROM sessions WHERE uid=?',+b.id);send(r,200,{ok:1})},
async 'POST /api/admin/reset'(q,r){if(!isAdmin(q))return send(r,403,{});const b=await body(q);if(b.confirm!=='RESET')return send(r,400,{error:'digite RESET'});
 ['saves','hist','ids','wday','credits','announces','alerts'].forEach(t=>X('DELETE FROM '+t));X('UPDATE users SET locked=0');
 const ep=String(Date.now());X("INSERT OR REPLACE INTO meta(k,v) VALUES('epoch',?)",ep);send(r,200,{ok:1,epoch:ep,users:Q1('SELECT COUNT(*) n FROM users').n})},
async 'POST /api/admin/wipe'(q,r){if(!isAdmin(q))return send(r,403,{});const b=await body(q);const P=new Set(Array.isArray(b.parts)?b.parts:[]);
 if(!P.size)return send(r,400,{error:'escolha o que apagar'});
 const rows=b.id==='all'?Q('SELECT uid FROM saves'):Q('SELECT uid FROM saves WHERE uid=?',+b.id);let n=0;const now=Date.now();
 rows.forEach(x=>{const sv=Q1('SELECT state FROM saves WHERE uid=?',x.uid);if(!sv)return;let st;try{st=JSON.parse(sv.state)}catch(e){return}
  if(P.has('eqs')){st.eqs=[];(st.chars||[]).forEach(c=>{c.eq=Array(11).fill(null)})}
  if(P.has('runes')){st.runes=[];(st.eqs||[]).forEach(e=>{e.rn=[]})}
  if(P.has('chars')){st.chars=[];st.team=[];st.sel=null;st.wipC=1}
  if(P.has('stages')){st.stage=1;st.dif=0;st.unl=0;st.pg=[1,1,1,1,1,1];st.mx=[1,1,1,1,1,1]}
  delete st.lock;const m=summarize(st);X('INSERT OR REPLACE INTO saves(uid,state,maxLv,sumLv,chars,gold,orc,stage,updated,dia) VALUES(?,?,?,?,?,?,?,?,?,?)',x.uid,JSON.stringify(st),m.maxLv,m.sumLv,m.chars,m.gold,m.orc,m.stage,now,st.dia|0);
  X('UPDATE users SET ep=COALESCE(ep,0)+1,locked=0 WHERE id=?',x.uid);n++});
 send(r,200,{ok:1,n})},
async 'GET /api/profile'(q,r,url){const u=user(q);if(!u)return send(r,401,{});const id=+url.searchParams.get('id')||0,nm=String(url.searchParams.get('name')||'').trim().slice(0,30);
 const row=id?Q1('SELECT u.id,u.name FROM users u WHERE u.id=? AND u.banned=0',id):(nm?Q1('SELECT u.id,u.name FROM users u LEFT JOIN profiles p ON p.uid=u.id WHERE u.banned=0 AND (u.name=? COLLATE NOCASE OR p.pn=? COLLATE NOCASE) LIMIT 1',nm,nm):null);
 if(!row)return send(r,404,{error:'Jogador não encontrado.'});
 const p=Q1('SELECT * FROM profiles WHERE uid=?',row.id)||{},s=Q1('SELECT maxLv,sumLv,chars,stage,prof,plv FROM saves WHERE uid=?',row.id)||{};
 send(r,200,{id:row.id,n:p.pn||row.name,av:p.av||'',bn:p.bn||'',vip:p.vip?1:0,tt:Number.isInteger(p.tt)?p.tt:-1,alv:p.alv|0,nc:p.vip?(p.nc||''):'',fc:p.vip?(p.fc||''):'',ff:p.vip?(p.ff||''):'',fg:p.vip?(p.fg||''):'',fs:p.vip?(p.fs||''):'',fw:p.vip?(p.fw|0):4,fi:p.vip?(p.fi||''):'',fc2:p.vip?(p.fc2||''):'',fc3:p.vip?(p.fc3||''):'',fm:p.vip?(p.fm||''):'',maxLv:s.maxLv|0,chars:s.chars|0,stage:s.stage|0,prof:s.prof||'',plv:s.plv|0})},
async 'GET /api/profrank'(q,r){const u=user(q);if(!u)return send(r,401,{});const o={};['Ferreiro','Joalheiro','Alquimista'].forEach(p=>{o[p]=Q('SELECT COALESCE(p.pn,u.name) n,u.id id,s.plv v,u.id=? me FROM saves s JOIN users u ON u.id=s.uid LEFT JOIN profiles p ON p.uid=u.id WHERE s.prof=? AND u.banned=0 ORDER BY s.plv DESC LIMIT 20',u.id,p).map(x=>({n:x.n,id:x.id,v:x.v,me:!!x.me}))});send(r,200,o)},
async 'POST /api/admin/credit'(q,r){if(!isAdmin(q))return send(r,403,{});const b=await body(q);const id=+b.id,dia=Math.trunc(+b.dia||0),orc=Math.trunc(+b.orc||0);
 if(!id||!Q1('SELECT 1 FROM users WHERE id=?',id)||(!dia&&!orc)||Math.abs(dia)>1e7||Math.abs(orc)>1e6)return send(r,400,{error:'dados inválidos'});
 X('INSERT INTO credits(uid,dia,orc,note,at) VALUES(?,?,?,?,?)',id,dia,orc,String(b.note||'').slice(0,200),Date.now());send(r,200,{ok:1})},
async 'GET /api/admin/credits'(q,r){if(!isAdmin(q))return send(r,403,{});send(r,200,Q('SELECT c.*,u.name FROM credits c JOIN users u ON u.id=c.uid ORDER BY c.id DESC LIMIT 100'))},
async 'GET /api/admin/history'(q,r,url){if(!isAdmin(q))return send(r,403,{});send(r,200,Q('SELECT id,at,length(state) len FROM hist WHERE uid=? ORDER BY id DESC',+url.searchParams.get('id')))},
async 'POST /api/admin/restore'(q,r){if(!isAdmin(q))return send(r,403,{});const b=await body(q);const h=Q1('SELECT * FROM hist WHERE id=? AND uid=?',+b.hid,+b.id);if(!h)return send(r,404,{});
 const st=JSON.parse(h.state);delete st.lock;const s=summarize(st);X('INSERT OR REPLACE INTO saves(uid,state,maxLv,sumLv,chars,gold,orc,stage,updated,dia) VALUES(?,?,?,?,?,?,?,?,?,?)',+b.id,h.state,s.maxLv,s.sumLv,s.chars,s.gold,s.orc,s.stage,Date.now(),st.dia|0);
 X('UPDATE users SET locked=1 WHERE id=?',+b.id);X('DELETE FROM sessions WHERE uid=?',+b.id);send(r,200,{ok:1,note:'Conta travada e deslogada; use Liberar para o jogador voltar com este save.'})},
async 'POST /api/admin/resetpass'(q,r){if(!isAdmin(q))return send(r,403,{});const b=await body(q);const p=String(b.pass||'');if(p.length<8)return send(r,400,{});
 const salt=crypto.randomBytes(16).toString('hex');X('UPDATE users SET salt=?,hash=? WHERE id=?',salt,crypto.scryptSync(p,salt,64).toString('hex'),+b.id);X('DELETE FROM sessions WHERE uid=?',+b.id);send(r,200,{ok:1})}};
// ---- arquivos estáticos: gzip em cache + ETag (o index.html tem ~12 MB)
const PUB=path.join(__dirname,'public'),SC=new Map();
function staticFile(q,r,url){const p=path.join(PUB,decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
 if(!p.startsWith(PUB+path.sep)&&p!==PUB)return false;let st;try{st=fs.statSync(p)}catch(e){return false}if(st.isDirectory())return false;
 const ext=path.extname(p).toLowerCase(),types={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.webp':'image/webp','.mp3':'audio/mpeg'};
 const etag='"'+st.size.toString(16)+'-'+Math.floor(st.mtimeMs).toString(16)+'"',h={'content-type':types[ext]||'application/octet-stream',etag,'cache-control':ext==='.html'?'no-cache':'public, max-age=3600'};
 if(q.headers['if-none-match']===etag){r.writeHead(304,h);r.end();return true}
 const zip=/\bgzip\b/.test(q.headers['accept-encoding']||'')&&['.html','.js','.css','.json','.svg'].includes(ext);
 if(zip){let c=SC.get(p);if(!c||c.etag!==etag){c={etag,buf:zlib.gzipSync(fs.readFileSync(p),{level:6})};SC.set(p,c)}h['content-encoding']='gzip';h.vary='accept-encoding';h['content-length']=c.buf.length;r.writeHead(200,h);r.end(c.buf);return true}
 h['content-length']=st.size;r.writeHead(200,h);fs.createReadStream(p).pipe(r);return true}
const srv=http.createServer(async(q,r)=>{const url=new URL(q.url,'http://x');
  r.setHeader('x-content-type-options','nosniff');r.setHeader('referrer-policy','same-origin');r.setHeader('x-frame-options','SAMEORIGIN');
  if(String(q.headers['x-forwarded-proto']||'')==='https')r.setHeader('strict-transport-security','max-age=15552000');
  try{const f=routes[q.method+' '+url.pathname];if(f)return await f(q,r,url);
   if((q.method==='GET'||q.method==='HEAD')&&staticFile(q,r,url))return;if(url.pathname==='/'&&!fs.existsSync(path.join(PUB,'index.html'))){r.writeHead(404,{'content-type':'text/plain;charset=utf-8'});r.end('Servidor no ar, mas falta o arquivo public/index.html no deploy (pasta '+PUB+'). Envie a pasta public inteira para o repositório.');return}r.writeHead(404);r.end('404')
  }catch(e){if(!r.headersSent)send(r,e===0?400:500,{error:'erro'})}});
if(DBD.persist===false&&!s3on())console.error('⚠️ ATENÇÃO: o banco ('+DBD.file+') está no disco TEMPORÁRIO ('+DBD.mount+' '+DBD.fstype+'). As contas serão APAGADAS a cada deploy/reinício. Crie um Disk (Render: Disks → Mount Path /data) e use DB=/data/jogo.db.');
if(!fs.existsSync(path.join(PUB,'index.html')))console.error('AVISO: '+path.join(PUB,'index.html')+' não existe — a página inicial dará 404.');
srv.keepAliveTimeout=65e3;srv.headersTimeout=70e3;
srv.listen(PORT,HOST,()=>console.log('Adventure Brazilian IDLE em http://'+(HOST==='0.0.0.0'?'localhost':HOST)+':'+PORT+'  (DB: '+(process.env.DB||'jogo.db')+')'));
// ---- backup diário do banco (VACUUM INTO), guarda os 7 mais recentes
const BK=process.env.BACKUP_DIR||path.join(path.dirname(path.resolve(process.env.DB||'jogo.db')),'backups');
function backup(){try{fs.mkdirSync(BK,{recursive:true});const fl=fs.readdirSync(BK).filter(f=>/^jogo-\d{8}-\d{4}\.db$/.test(f)).sort();const last=fl[fl.length-1];
 if(last){const m=fs.statSync(path.join(BK,last)).mtimeMs;if(Date.now()-m<23.5*3600e3)return}
 const d=new Date(),pad=n=>String(n).padStart(2,'0'),name=`jogo-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.db`;
 db.exec(`VACUUM INTO '${path.join(BK,name).replace(/'/g,"''")}'`);console.log('backup',name);
 fs.readdirSync(BK).filter(f=>/^jogo-\d{8}-\d{4}\.db$/.test(f)).sort().slice(0,-7).forEach(f=>{try{fs.unlinkSync(path.join(BK,f))}catch(e){}})}catch(e){console.error('backup falhou',e.message)}}
if(process.env.BACKUP!=='0'){setTimeout(backup,15e3);setInterval(backup,3600e3)}

// ---- envio do backup remoto
const S3S={on:s3on(),ok:0,err:'',n:0};let s3sig='',s3day='',s3busy=false;
async function s3Backup(force){if(!s3on()||s3busy)return;s3busy=true;try{
 const sig=Q1("SELECT (SELECT COUNT(*) FROM users)||':'||(SELECT COUNT(*) FROM sessions)||':'||(SELECT COALESCE(MAX(updated),0) FROM saves)||':'||(SELECT COUNT(*) FROM alerts) v").v;
 if(!force&&sig===s3sig)return;const tmp=DBF+'.up';try{fs.unlinkSync(tmp)}catch(e){}db.exec(`VACUUM INTO '${tmp.replace(/'/g,"''")}'`);
 const gz=zlib.gzipSync(fs.readFileSync(tmp),{level:6});try{fs.unlinkSync(tmp)}catch(e){}
 const a=await s3('PUT',S3LATEST,gz);if(a.status>=300)throw new Error('S3 PUT '+a.status+' '+a.buf.toString().slice(0,160));
 const d=new Date().toISOString().slice(0,10);if(d!==s3day){const b=await s3('PUT',S3P+'/diario/jogo-'+d+'.db.gz',gz);if(b.status<300)s3day=d}
 s3sig=sig;S3S.ok=Date.now();S3S.err='';S3S.n++}catch(e){S3S.err=String(e.message||e).slice(0,200);console.error('☁️ backup remoto falhou:',S3S.err)}finally{s3busy=false}}
if(s3on()){console.log('☁️ backup remoto ligado → '+process.env.S3_BUCKET+'/'+S3P);setTimeout(()=>s3Backup(1),8e3);setInterval(()=>s3Backup(0),Math.max(30,+process.env.S3_EVERY_S||120)*1e3)}
// ---- limpeza de sessões antigas e encerramento limpo
setInterval(()=>{try{X('DELETE FROM sessions WHERE created<?',Date.now()-90*864e5)}catch(e){}},6*3600e3);
let byeing=0;async function bye(){if(byeing)return;byeing=1;console.log('encerrando…');for(const rm of ROOMS.values())for(const p of rm.peers.values())try{p.res.end()}catch(e){}try{srv.close()}catch(e){}if(s3on()){s3busy=false;try{await Promise.race([s3Backup(1),new Promise(r=>setTimeout(r,20000))]);console.log('☁️ backup final '+(S3S.err?'FALHOU':'ok'))}catch(e){}}try{db.close()}catch(e){}process.exit(0)}
process.on('SIGTERM',bye);process.on('SIGINT',bye);
