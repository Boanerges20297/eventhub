'use strict';
// Simulador financeiro didatico: NAO cobra dinheiro nem possui gateway real.
// Tabela isolada em eventhub_payments. Inscricoes permanece autoridade da vaga.
const crypto = require('node:crypto');
const { db } = require('./database');
const { internal, asHeaders } = require('./security');
const serviceUrl = process.env.REGISTRATIONS_URL || 'http://registrations:8000';
const choices = new Set(['PAGO', 'RECUSADO_DEFINITIVO', 'INDETERMINADO']);

async function callRegistration(path, method, principal, body) {
  try {
    const response = await fetch(serviceUrl + path, {
      method,
      headers: {...asHeaders(principal),'content-type':'application/json'},
      body: method==='GET'?undefined:JSON.stringify(body||{}),
      signal:AbortSignal.timeout(5000)
    });
    return {code:response.status, data:await response.json().catch(()=>({}))};
  } catch {return {code:503,data:{error:'INSCRICOES_INDISPONIVEL'}};}
}
function user(request,reply) {
  let p;
  try{p=internal(request);}catch {
    reply.code(403).send({error:'SERVICO_NAO_AUTORIZADO'});return null;
  }
  if (!p || !['participant','admin'].includes(p.role)) {
    reply.code(403).send({error:'SEM_PERMISSAO'});return null;
  }
  return p;
}
async function attemptFor(id) {
  const [rows]=await db().execute(
    'SELECT id,inscricao_id,user_id,outcome,paid_at,delivery,registration_status FROM payment_attempts WHERE inscricao_id=?',
    [id]
  );
  return rows[0]||null;
}
async function deliver(row, principal) {
  if(row.delivery==='ENTREGUE'){
    return {status:200,data:{inscricao_id:row.inscricao_id,
      tentativa_id:row.id,simulado:true,resultado:row.outcome,
      estado_inscricao:row.registration_status}};
  }
  // Processa eventos com mesmo ID; um replay nunca altera data/resultado.
  const base='/internal/inscricoes/'+row.inscricao_id;
  const payload={
    event_id:row.id,attempt_id:row.id,resultado:row.outcome,
    pago_em:row.paid_at instanceof Date
      ? row.paid_at.toISOString()
      : (row.paid_at ? new Date(row.paid_at).toISOString() : null)
  };
  // Se MySQL de Inscricoes confirmou mas a gravacao no banco de Pagamentos
  // falhou, a consulta ao ledger original recupera o resultado.
  let settled;
  if(row.delivery==='VERIFICANDO'){
    settled=await callRegistration(base+'/resultado-pagamento','POST',principal,payload);
  }
  if(!settled || (settled.code===409 && settled.data.detail==='ESTADO_FINANCEIRO_INCOMPATIVEL')){
    const started=await callRegistration(base+'/inicio-pagamento','POST',principal,
      {attempt_id:row.id});
    if(started.code!==200){
      return {status:started.code===503?202:started.code,
        data:{error:started.data.detail||started.data.error||'AGUARDANDO_CONCILIACAO',
              tentativa_id:row.id,simulado:true}};
    }
    await db().execute("UPDATE payment_attempts SET delivery='VERIFICANDO' WHERE id=?",[row.id]);
    settled=await callRegistration(base+'/resultado-pagamento','POST',principal,payload);
  }
  if(settled.code!==200){
    return {status:settled.code===503?202:settled.code,
      data:{error:settled.data.detail||settled.data.error||'AGUARDANDO_CONCILIACAO',
            tentativa_id:row.id,simulado:true}};
  }
  await db().execute(
    "UPDATE payment_attempts SET delivery='ENTREGUE',registration_status=? WHERE id=?",
    [settled.data.estado,row.id]
  );
  return {status:200,data:{inscricao_id:row.inscricao_id,tentativa_id:row.id,
    simulado:true,resultado:row.outcome,estado_inscricao:settled.data.estado}};
}
function install(server) {
  server.post('/internal/pagamentos/:id/simular',async(request,reply)=>{
    const p=user(request,reply);if(!p)return;
    const id=request.params.id;
    const {resultado,idempotency_key}=request.body||{};
    if(typeof id!=='string'||!crypto.randomUUID||
       !choices.has(resultado)||typeof idempotency_key!=='string'||
       !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotency_key))
      return reply.code(400).send({error:'SIMULACAO_INVALIDA'});
    let row=await attemptFor(id);
    if(row) {
      if(row.id!==idempotency_key||row.user_id!==p.sub||row.outcome!==resultado)
        return reply.code(409).send({error:'TENTATIVA_JA_EXISTENTE'});
      if(row.delivery==='ENTREGUE'){
        const done=await deliver(row,p);
        return reply.code(done.status).send(done.data);
      }
    } else {
      const context=await callRegistration('/internal/inscricoes/'+id+'/pagamento','GET',p);
      if(context.code!==200)return reply.code(context.code).send(context.data);
      if(context.data.status!=='RESERVADO')
        return reply.code(409).send({error:'RESERVA_NAO_DISPONIVEL'});
      try {
        await db().execute(
          'INSERT INTO payment_attempts (id,inscricao_id,user_id,outcome,paid_at) VALUES (?,?,?,?,?)',
          [idempotency_key,id,p.sub,resultado,resultado==='PAGO'?new Date():null]
        );
      }catch(e){
        if(e.code!=='ER_DUP_ENTRY')throw e;
      }
      row=await attemptFor(id);
      if(!row||row.id!==idempotency_key||row.user_id!==p.sub||row.outcome!==resultado)
        return reply.code(409).send({error:'TENTATIVA_JA_EXISTENTE'});
    }
    const result=await deliver(row,p);
    return reply.code(result.status).send(result.data);
  });
  server.get('/internal/pagamentos/:id',async(request,reply)=>{
    const p=user(request,reply);if(!p)return;
    const row=await attemptFor(request.params.id);
    if(!row||row.user_id!==p.sub) return reply.code(404).send({error:'PAGAMENTO_NAO_ENCONTRADO'});
    return {inscricao_id:row.inscricao_id,tentativa_id:row.id,simulado:true,
      resultado:row.outcome,entrega:row.delivery,estado_inscricao:row.registration_status};
  });
}
module.exports={install};
