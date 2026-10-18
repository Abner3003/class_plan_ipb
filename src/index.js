import { generateField } from './ai.js';

const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; upgrade-insecure-requests",
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY'
};
const JSON_HEADERS = { ...SECURITY_HEADERS, 'cache-control': 'no-store', 'content-type': 'application/json; charset=UTF-8' };
const COOKIE = 'pb_session';
function json(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{...JSON_HEADERS,...headers}})}
function b64url(bytes){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function unb64url(s){s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
async function hmac(secret,data){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64url(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(data))))}
function safeEqual(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let different=0;for(let i=0;i<a.length;i++)different|=a.charCodeAt(i)^b.charCodeAt(i);return different===0}
async function sessionToken(env,teacher){const payload=b64url(new TextEncoder().encode(JSON.stringify({id:teacher.id,name:teacher.name,exp:Date.now()+7*864e5})));return payload+'.'+await hmac(env.SESSION_SECRET,payload)}
async function auth(request,env){if(!env.SESSION_SECRET)return null;const raw=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);if(!raw)return null;const [p,s]=raw.split('.');if(!p||!s||!safeEqual(await hmac(env.SESSION_SECRET,p),s))return null;try{const data=JSON.parse(new TextDecoder().decode(unb64url(p)));return Number.isInteger(data.id)&&typeof data.name==='string'&&data.exp>Date.now()?data:null}catch{return null}}
async function hashCode(code,salt){const data=new TextEncoder().encode(`${salt}:${code}`);let out=data;for(let i=0;i<120000;i++)out=new Uint8Array(await crypto.subtle.digest('SHA-256',out));return b64url(out)}
function cookie(token){return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800; Priority=High`}
function requireDb(env){if(!env.DB)throw new Error('D1 binding DB não configurado.')}
async function readJson(request,maxBytes){const text=await request.text();if(new TextEncoder().encode(text).length>maxBytes)throw new Response(null,{status:413});try{const data=JSON.parse(text);if(!data||typeof data!=='object'||Array.isArray(data))throw new Error();return data}catch{throw new Response(null,{status:400})}}
function mutationAllowed(request){const origin=request.headers.get('origin');const site=request.headers.get('sec-fetch-site');return (!origin||origin===new URL(request.url).origin)&&site!=='cross-site'}
async function allowed(env,identifier,action,limit,windowSeconds){
  const keyHash=await hmac(env.SESSION_SECRET,identifier);
  const now=Math.floor(Date.now()/1000);
  const bucket=Math.floor(now/windowSeconds);
  await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<?').bind(now).run();
  const row=await env.DB.prepare('INSERT INTO rate_limits(key_hash,action,window_bucket,count,expires_at) VALUES(?,?,?,1,?) ON CONFLICT(key_hash,action,window_bucket) DO UPDATE SET count=count+1 RETURNING count').bind(keyHash,action,bucket,(bucket+1)*windowSeconds).first();
  return Number(row?.count||limit+1)<=limit;
}
function secureAsset(response){const headers=new Headers(response.headers);for(const [name,value] of Object.entries(SECURITY_HEADERS))headers.set(name,value);return new Response(response.body,{status:response.status,statusText:response.statusText,headers})}
export default { async fetch(request,env){
  const url=new URL(request.url);
  try {
    if(url.pathname.startsWith('/api/')&&!['GET','HEAD','OPTIONS'].includes(request.method)&&!mutationAllowed(request))return json({error:'Origem da requisição não permitida.'},403);
    if(url.pathname==='/api/login'&&request.method==='POST'){
      requireDb(env); if(!env.SESSION_SECRET)return json({error:'SESSION_SECRET não configurado.'},500);
      const ip=request.headers.get('cf-connecting-ip')||'unknown';
      if(!await allowed(env,`login-ip:${ip}`,'login',30,900))return json({error:'Muitas tentativas. Aguarde 15 minutos.'},429,{'retry-after':'900'});
      const {name='',code=''}=await readJson(request,2048);
      if(typeof name!=='string'||name.length>60||typeof code!=='string'||code.length<8||code.length>128)return json({error:'Nome ou código inválido.'},401);
      if(!await allowed(env,`login-user:${ip}:${name.toLocaleLowerCase('pt-BR')}`,'login-user',8,900))return json({error:'Muitas tentativas. Aguarde 15 minutos.'},429,{'retry-after':'900'});
      const t=await env.DB.prepare('SELECT id,name,access_code_hash,code_salt FROM teachers WHERE name=? COLLATE NOCASE').bind(name).first();
      if(!t||!safeEqual(await hashCode(code,t.code_salt),t.access_code_hash))return json({error:'Nome ou código inválido.'},401);
      return json({teacher:{id:t.id,name:t.name}},200,{'set-cookie':cookie(await sessionToken(env,t))});
    }
    if(url.pathname==='/api/logout'&&request.method==='POST') return json({ok:true},200,{'set-cookie':`${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`});
    if(url.pathname==='/api/me'&&request.method==='GET'){const me=await auth(request,env);return me?json({teacher:{id:me.id,name:me.name}}):json({error:'Não autenticado.'},401)}
    const me=await auth(request,env);
    if(url.pathname.startsWith('/api/')&&!me)return json({error:'Não autenticado.'},401);
    if(url.pathname==='/api/plans'&&request.method==='GET'){
      requireDb(env);const rows=await env.DB.prepare("SELECT id,COALESCE(NULLIF(TRIM(json_extract(data, '$.field_0')), ''),title) AS title,json_extract(data, '$.field_1') AS lesson_date,status,updated_at FROM lesson_plans WHERE teacher_id=? ORDER BY updated_at DESC").bind(me.id).all();return json({plans:rows.results});
    }
    if(url.pathname==='/api/plans'&&request.method==='POST'){
      requireDb(env);if(!await allowed(env,`teacher:${me.id}`,'plan-write',120,60))return json({error:'Muitas alterações. Aguarde um minuto.'},429,{'retry-after':'60'});const {title='Novo plano'}=await readJson(request,4096);if(typeof title!=='string')return json({error:'Título inválido.'},400);const id=crypto.randomUUID();const now=new Date().toISOString();
      await env.DB.prepare('INSERT INTO lesson_plans(id,teacher_id,title,status,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(id,me.id,String(title).slice(0,120),'draft','{}',now,now).run();return json({id,title,status:'draft',updated_at:now},201);
    }
    const match=url.pathname.match(/^\/api\/plans\/([^/]+)$/);
    if(match&&request.method==='GET'){requireDb(env);const p=await env.DB.prepare('SELECT id,title,status,data,updated_at FROM lesson_plans WHERE id=? AND teacher_id=?').bind(match[1],me.id).first();return p?json({...p,data:JSON.parse(p.data||'{}')}):json({error:'Plano não encontrado.'},404)}
    if(match&&request.method==='PUT'){requireDb(env);if(!await allowed(env,`teacher:${me.id}`,'plan-write',120,60))return json({error:'Muitas alterações. Aguarde um minuto.'},429,{'retry-after':'60'});const body=await readJson(request,110000);if(!body.data||typeof body.data!=='object'||Array.isArray(body.data)||typeof body.title!=='string')return json({error:'Plano inválido.'},400);const data=JSON.stringify(body.data);if(data.length>100000)return json({error:'Plano muito grande.'},413);const now=new Date().toISOString();
      const r=await env.DB.prepare('UPDATE lesson_plans SET title=?,status=?,data=?,updated_at=? WHERE id=? AND teacher_id=?').bind(String(body.title||'Novo plano').slice(0,120),body.status==='final'?'final':'draft',data,now,match[1],me.id).run();return r.meta.changes?json({ok:true,updated_at:now}):json({error:'Plano não encontrado.'},404)}
    if(url.pathname==='/api/songs'&&request.method==='GET'){requireDb(env);const rows=await env.DB.prepare('SELECT id,title,text FROM songs ORDER BY title COLLATE NOCASE').all();return json({songs:rows.results})}
    const songMatch=url.pathname.match(/^\/api\/songs(?:\/(\d+))?$/);
    if(songMatch&&['POST','PUT','DELETE'].includes(request.method)){
      requireDb(env);if(!await allowed(env,`teacher:${me.id}`,'song-write',60,60))return json({error:'Muitas alterações. Aguarde um minuto.'},429,{'retry-after':'60'});
      const id=songMatch[1]?Number(songMatch[1]):null;
      if(request.method==='POST'&&id||request.method!=='POST'&&!id)return json({error:'Rota inválida.'},404);
      if(request.method==='DELETE'){const r=await env.DB.prepare('DELETE FROM songs WHERE id=?').bind(id).run();return r.meta.changes?json({ok:true}):json({error:'Música não encontrada.'},404)}
      const {title='',text=''}=await readJson(request,20000);
      if(typeof title!=='string'||typeof text!=='string'||!title.trim()||!text.trim()||title.length>120||text.length>10000)return json({error:'Informe título e letra (máx. 120 e 10.000 caracteres).'},400);
      if(request.method==='POST'){const row=await env.DB.prepare('INSERT INTO songs(title,text) VALUES(?,?) RETURNING id,title,text').bind(title.trim(),text.trim()).first();return json(row,201)}
      const row=await env.DB.prepare('UPDATE songs SET title=?,text=?,updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING id,title,text').bind(title.trim(),text.trim(),id).first();return row?json(row):json({error:'Música não encontrada.'},404);
    }
    if(url.pathname==='/api/ai'&&request.method==='POST'){
      if(!env.OPENAI_API_KEY)return json({error:'Serviço de IA não configurado.'},503);if(!await allowed(env,`teacher:${me.id}`,'ai',30,3600))return json({error:'Limite de uso da IA atingido. Tente novamente mais tarde.'},429,{'retry-after':'3600'});const body=await readJson(request,50000);const {action,field='',text='',context=[]}=body;
      if(!['complete','spellcheck'].includes(action))return json({error:'Ação inválida.'},400);if(typeof field!=='string'||field.length>200||typeof text!=='string'||text.length>5000||!Array.isArray(context)||context.length>50)return json({error:'Conteúdo inválido.'},400);
      const instruction=action==='spellcheck'?'Corrija apenas ortografia, pontuação, concordância e erros de digitação. Preserve significado, estilo, estrutura e conteúdo. Não acrescente ideias novas.':'Complete somente o campo solicitado de forma prática e coerente com uma ficha de plano de aula infantil cristã. Use os demais campos preenchidos como contexto: considere o nome e tema da lição, faixa etária, referência e versículo bíblico, duração, materiais e atividades já planejadas. Respeite a sequência da aula, evite contradições e repetições desnecessárias e preserve o que já foi escrito. Quando faltar contexto, não invente dados factuais. Retorne apenas o conteúdo do campo solicitado.';
      const result = await generateField(env, { action, field, text, context, instruction });
      return result.error ? json({ error: result.error }, result.status) : json({ text: result.text });
    }
    return secureAsset(await env.ASSETS.fetch(request));
  } catch(e){if(e instanceof Response)return json({error:e.status===413?'Requisição muito grande.':'Requisição inválida.'},e.status);console.error('Unhandled request error',e);return json({error:'Erro interno.'},500)}
}};
