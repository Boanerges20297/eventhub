'use strict';
const crypto = require('node:crypto');
const { db } = require('./database');
const { internal, asHeaders } = require('./security');

function authorized(request, reply, roles=[]) {
  let p;
  try { p = internal(request); }
  catch { reply.code(403).send({ error:'SERVICO_NAO_AUTORIZADO' }); return null; }
  if (!p || (roles.length && !roles.includes(p.role))) {
    reply.code(403).send({error:'SEM_PERMISSAO'}); return null;
  }
  return p;
}
function isOwner(p,org) { return p.role === 'admin' || (p.role==='organizer' && p.org_id===org); }
// Espelho em SQLite apenas DEPOIS de Eventos confirmar sua publicacao.
// Falha aqui nao muda a verdade no MySQL de Eventos: a API pode preencher
// o cache ao receber uma validacao positiva posterior. Sem cache, falha fechada.
async function mirrorPublication(id, version) {
  try {
    const response=await fetch(
      (process.env.REGISTRATIONS_URL||'http://registrations:8000')+'/internal/publicacoes',{
        method:'POST',
        headers:{...asHeaders(null),'content-type':'application/json'},
        body:JSON.stringify({atividade_id:id, capacidade_version:Number(version)}),
        signal:AbortSignal.timeout(3000)
      }
    );
    return response.ok;
  } catch { return false; }
}
async function capacitySync(row) {
  const response=await fetch((process.env.REGISTRATIONS_URL||'http://registrations:8000')+'/internal/capacidades',{
    method:'POST',headers:{...asHeaders(null),'content-type':'application/json'},
    body:JSON.stringify({
      atividade_id:row.id, operation_id:row.operation_id,
      expected_version:Number(row.capacity_version),
      target_version:Number(row.capacity_version)+1,
      capacidade:Number(row.capacity), lista_espera_habilitada:!!row.waitlist,
      prazo_reserva_min:Number(row.hold_minutes), atividade_paga:!!row.paid
    }), signal:AbortSignal.timeout(4500)
  });
  const data=await response.json();
  if(!response.ok || data.result!=='APLICADA') return {ok:false,detail:data};
  await db().execute(
    "UPDATE activities SET capacity_version=?,capacity_state='CONCLUIDA' WHERE id=? AND operation_id=?",
    [data.version,row.id,row.operation_id]
  );
  await mirrorPublication(row.id, data.version);
  return {ok:true,version:data.version};
}
async function activityById(id) {
  const [rows]=await db().execute(
    'SELECT id,event_id,org_id,title,capacity,capacity_version,capacity_state,operation_id,paid,price_cents,waitlist,hold_minutes FROM activities WHERE id=?',
    [id]);
  return rows[0]||null;
}
function install(server){

  // Private organizer dashboard: ownership is checked in this domain.
  server.get('/internal/me/eventos',async(req,reply)=>{
    const p=authorized(req,reply,['organizer','admin']);if(!p)return;
    if(p.role==='organizer'&&!p.org_id)return reply.code(403).send({error:'ORGANIZACAO_OBRIGATORIA'});
    const [rows]=await db().execute(
      'SELECT e.id,e.title,e.description,e.org_id,e.created_at,COUNT(a.id) atividades_total,'
      +" SUM(CASE WHEN a.capacity_state='CONCLUIDA' THEN 1 ELSE 0 END) atividades_publicadas,"
      +" SUM(CASE WHEN a.capacity_state<>'CONCLUIDA' THEN 1 ELSE 0 END) atividades_pendentes"
      +' FROM events e LEFT JOIN activities a ON a.event_id=e.id'
      +(p.role==='admin'?'':' WHERE e.org_id=?')
      +' GROUP BY e.id,e.title,e.description,e.org_id,e.created_at ORDER BY e.created_at DESC LIMIT 100',
      p.role==='admin'?[]:[p.org_id]);
    return {eventos:rows.map(e=>({...e,atividades_total:Number(e.atividades_total),
      atividades_publicadas:Number(e.atividades_publicadas),atividades_pendentes:Number(e.atividades_pendentes)}))};
  });
  server.get('/internal/me/eventos/:id/atividades',async(req,reply)=>{
    const p=authorized(req,reply,['organizer','admin']);if(!p)return;
    const [events]=await db().execute('SELECT id,title,description,org_id FROM events WHERE id=?',[req.params.id]);
    if(!events.length||!isOwner(p,events[0].org_id))
      return reply.code(404).send({error:'EVENTO_NAO_ENCONTRADO'});
    const [rows]=await db().execute(
      'SELECT id,title,capacity,capacity_version,capacity_state,paid,price_cents,waitlist,hold_minutes'
      +' FROM activities WHERE event_id=? ORDER BY created_at ASC',[req.params.id]);
    return {evento:events[0],atividades:rows.map(a=>({
      atividade_id:a.id,titulo:a.title,capacidade:Number(a.capacity),
      capacidade_version:Number(a.capacity_version),sincronizacao:a.capacity_state,
      publicada:a.capacity_state==='CONCLUIDA',gratuita:!a.paid,
      preco_centavos:Number(a.price_cents),lista_espera_habilitada:!!a.waitlist,
      prazo_reserva_min:Number(a.hold_minutes)}))};
  });
  server.patch('/internal/me/eventos/:id',async(req,reply)=>{
    const p=authorized(req,reply,['organizer','admin']);if(!p)return;
    const [rows]=await db().execute('SELECT title,description,org_id FROM events WHERE id=?',[req.params.id]);
    if(!rows.length||!isOwner(p,rows[0].org_id))
      return reply.code(404).send({error:'EVENTO_NAO_ENCONTRADO'});
    const b=req.body||{};
    if(!Object.hasOwn(b,'titulo')&&!Object.hasOwn(b,'descricao'))
      return reply.code(400).send({error:'CAMPOS_OBRIGATORIOS'});
    const title=Object.hasOwn(b,'titulo')?b.titulo:rows[0].title;
    const description=Object.hasOwn(b,'descricao')?b.descricao:rows[0].description;
    if(typeof title!=='string'||title.trim().length<3||title.trim().length>160
       ||typeof description!=='string'||description.trim().length>4000)
      return reply.code(400).send({error:'DADOS_INVALIDOS'});
    await db().execute('UPDATE events SET title=?,description=? WHERE id=?',
      [title.trim(),description.trim(),req.params.id]);
    return {evento_id:req.params.id,titulo:title.trim(),descricao:description.trim()};
  });
  server.patch('/internal/me/atividades/:id',async(req,reply)=>{
    const p=authorized(req,reply,['organizer','admin']);if(!p)return;
    const row=await activityById(req.params.id);
    if(!row||!isOwner(p,row.org_id))
      return reply.code(404).send({error:'ATIVIDADE_NAO_ENCONTRADA'});
    const title=req.body?.titulo;
    if(typeof title!=='string'||title.trim().length<3||title.trim().length>160)
      return reply.code(400).send({error:'DADOS_INVALIDOS'});
    await db().execute('UPDATE activities SET title=? WHERE id=?',[title.trim(),row.id]);
    return {atividade_id:row.id,titulo:title.trim()};
  });
  server.get('/internal/me/atividades/:id/resumo',async(req,reply)=>{
    const p=authorized(req,reply,['organizer','admin']);if(!p)return;
    const row=await activityById(req.params.id);
    if(!row||!isOwner(p,row.org_id))
      return reply.code(404).send({error:'ATIVIDADE_NAO_ENCONTRADA'});
    if(row.capacity_state!=='CONCLUIDA')return {atividade_id:row.id,publicada:false,resumo:null};
    try{
      const r=await fetch((process.env.REGISTRATIONS_URL||'http://registrations:8000')
        +'/internal/atividades/'+encodeURIComponent(row.id)+'/resumo',{
          headers:asHeaders(null),signal:AbortSignal.timeout(5000)});
      if(!r.ok)return reply.code(503).send({error:'RESUMO_INDISPONIVEL'});
      return {atividade_id:row.id,publicada:true,resumo:await r.json()};
    }catch{return reply.code(503).send({error:'RESUMO_INDISPONIVEL'});}
  });

  server.get('/internal/me/atividades/:id/inscricoes',async(req,reply)=>{
    const p=authorized(req,reply,['organizer','admin']);if(!p)return;
    const row=await activityById(req.params.id);
    if(!row||!isOwner(p,row.org_id))
      return reply.code(404).send({error:'ATIVIDADE_NAO_ENCONTRADA'});
    if(row.capacity_state!=='CONCLUIDA')
      return reply.code(409).send({error:'ATIVIDADE_NAO_PUBLICADA'});
    const query=new URLSearchParams();
    for(const key of ['limit','offset','estado']){
      if(req.query?.[key]!==undefined)query.set(key,String(req.query[key]));
    }
    try{
      const r=await fetch((process.env.REGISTRATIONS_URL||'http://registrations:8000')
        +'/internal/atividades/'+encodeURIComponent(row.id)+'/inscricoes'
        +(query.size?'?'+query.toString():''),{
          headers:asHeaders(null),signal:AbortSignal.timeout(5000)});
      const data=await r.json().catch(()=>({error:'RESPOSTA_INVALIDA'}));
      if(!r.ok)return reply.code(r.status).send(data);
      return data;
    }catch{return reply.code(503).send({error:'INSCRICOES_INDISPONIVEIS'});}
  });
  server.get('/internal/eventos',async(request,reply)=>{
    try{internal(request);}catch{return reply.code(403).send({error:'SERVICO_NAO_AUTORIZADO'});}
    const [rows]=await db().query(
      "SELECT e.id,e.title,e.description, COUNT(a.id) AS atividades FROM events e JOIN activities a ON a.event_id=e.id AND a.capacity_state='CONCLUIDA' GROUP BY e.id ORDER BY e.created_at DESC LIMIT 100"
    );
    return {eventos:rows};
  });
  server.get('/internal/eventos/:id/atividades',async(request,reply)=>{
    try{internal(request);}catch{return reply.code(403).send({error:'SERVICO_NAO_AUTORIZADO'});}
    const [rows]=await db().execute(
      "SELECT id,title,capacity,paid,price_cents,waitlist,hold_minutes FROM activities WHERE event_id=? AND capacity_state='CONCLUIDA' ORDER BY created_at ASC",
      [request.params.id]
    );
    return {atividades:rows.map(row=>({
      atividade_id:row.id,titulo:row.title,capacidade:row.capacity,
      gratuita:!row.paid,preco_centavos:row.price_cents,
      lista_espera_habilitada:!!row.waitlist,prazo_reserva_min:row.hold_minutes
    }))};
  });
  server.post('/internal/eventos',async(request,reply)=>{
    const p=authorized(request,reply,['organizer','admin']);if(!p)return;
    if(!p.org_id && p.role!=='admin') return reply.code(403).send({error:'ORGANIZACAO_OBRIGATORIA'});
    const title=String(request.body?.titulo||'').trim();
    const description=String(request.body?.descricao||'').trim();
    if(title.length<3||title.length>160||description.length>4000)
      return reply.code(400).send({error:'DADOS_INVALIDOS'});
    const id=crypto.randomUUID(),org=p.org_id||'org-admin';
    await db().execute(
      'INSERT INTO events (id,owner_id,org_id,title,description) VALUES (?,?,?,?,?)',
      [id,p.sub,org,title,description]
    );
    return reply.code(201).send({evento_id:id,organizacao_id:org});
  });
  server.post('/internal/eventos/:id/atividades',async(request,reply)=>{
    const p=authorized(request,reply,['organizer','admin']);if(!p)return;
    const [events]=await db().execute('SELECT id,org_id FROM events WHERE id=?',[request.params.id]);
    if(!events.length)return reply.code(404).send({error:'EVENTO_NAO_ENCONTRADO'});
    if(!isOwner(p,events[0].org_id))return reply.code(403).send({error:'SEM_PERMISSAO'});
    const body=request.body||{},title=String(body.titulo||'').trim();
    const capacity=Number(body.capacidade),hold=body.prazo_reserva_min===undefined?30:Number(body.prazo_reserva_min);
    const paid=body.gratuita===false,price=Number(body.preco_centavos||0);
    const waitlist=body.lista_espera_habilitada!==false;
    if(title.length<3||title.length>160||!Number.isInteger(capacity)||capacity<0||capacity>100000||
       !Number.isInteger(hold)||hold<1||hold>1440||!Number.isInteger(price)||price<0||
       (paid && price===0)||(body.gratuita!==undefined&&typeof body.gratuita!=='boolean')||
       (body.lista_espera_habilitada!==undefined&&typeof body.lista_espera_habilitada!=='boolean'))
       return reply.code(400).send({error:'DADOS_INVALIDOS'});
    const id=crypto.randomUUID(),operation_id=crypto.randomUUID();
    await db().execute(
      'INSERT INTO activities (id,event_id,org_id,title,capacity,operation_id,paid,price_cents,waitlist,hold_minutes) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [id,request.params.id,events[0].org_id,title,capacity,operation_id,paid,price,waitlist,hold]
    );
    let synced;
    try {synced=await capacitySync(await activityById(id));}
    catch {synced={ok:false};}
    return reply.code(synced.ok?201:202).send({
      atividade_id:id,sincronizacao:synced.ok?'CONCLUIDA':'PENDENTE',
      publicada:!!synced.ok,capacidade_version:synced.ok?1:0
    });
  });
  server.post('/internal/atividades/:id/sincronizar',async(request,reply)=>{
    const p=authorized(request,reply,['organizer','admin']);if(!p)return;
    const row=await activityById(request.params.id);
    if(!row)return reply.code(404).send({error:'ATIVIDADE_NAO_ENCONTRADA'});
    if(!isOwner(p,row.org_id))return reply.code(403).send({error:'SEM_PERMISSAO'});
    if(row.capacity_state==='CONCLUIDA'){
      await mirrorPublication(row.id,row.capacity_version);
      return {sincronizacao:'CONCLUIDA',capacidade_version:row.capacity_version};
    }
    let synced;try{synced=await capacitySync(row);}catch{synced={ok:false};}
    return reply.code(synced.ok?200:202).send({sincronizacao:synced.ok?'CONCLUIDA':'PENDENTE'});
  });
  server.get('/internal/atividades/:id',async(request,reply)=>{
    try{internal(request);}catch{return reply.code(403).send({error:'SERVICO_NAO_AUTORIZADO'});}
    const row=await activityById(request.params.id);
    if(!row||row.capacity_state!=='CONCLUIDA') return reply.code(404).send({error:'ATIVIDADE_NAO_PUBLICADA'});
    return {atividade_id:row.id,evento_id:row.event_id,titulo:row.title,
      capacidade:row.capacity,capacidade_version:row.capacity_version,
      gratuita:!row.paid,preco_centavos:row.price_cents,
      lista_espera_habilitada:!!row.waitlist,prazo_reserva_min:row.hold_minutes,publicada:true};
  });
}
module.exports={install};
