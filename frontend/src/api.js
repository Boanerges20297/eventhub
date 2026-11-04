/**
 * Único ponto de conexão HTTP do frontend EventHub.
 * O gateway /api resolve os microsserviços no ambiente de destino.
 * Desktop, navegador e notebook usam os mesmos contratos;
 * nenhuma URL de container, IP ou porta de desenvolvimento é codificada aqui.
 */
export const routes=Object.freeze({
  session:'/auth/me',
  register:'/auth/register',
  login:'/auth/login',
  logout:'/auth/logout',
  events:'/eventos',
  managedEvents:'/me/eventos',
  managedEventActivities:id=>'/me/eventos/'+encodeURIComponent(id)+'/atividades',
  editEvent:id=>'/me/eventos/'+encodeURIComponent(id),
  editActivity:id=>'/me/atividades/'+encodeURIComponent(id),
  activitySummary:id=>'/me/atividades/'+encodeURIComponent(id)+'/resumo',
  synchronizeActivity:id=>'/atividades/'+encodeURIComponent(id)+'/sincronizar',

  eventActivities:eventId=>'/eventos/'+encodeURIComponent(eventId)+'/atividades',
  registrations:'/inscricoes',
  myRegistrations:(limit=50,offset=0)=>'/inscricoes?limit='+limit+'&offset='+offset,
  registration:id=>'/inscricoes/'+encodeURIComponent(id),
  cancelRegistration:id=>'/inscricoes/'+encodeURIComponent(id)+'/cancelar',
  paymentSimulation:id=>'/pagamentos/'+encodeURIComponent(id)+'/simular',
  notifications:'/notificacoes'
});

export async function requestApi(path,{method='GET',body,csrf,idempotencyKey}={}){
  if(!path.startsWith('/')||path.startsWith('//')){
    throw new Error('Rota interna inválida.');
  }
  const headers={};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(csrf && method!=='GET')headers['X-CSRF-Token']=csrf;
  if(idempotencyKey)headers['Idempotency-Key']=idempotencyKey;
  const response=await fetch('/api'+path,{
    method,headers,credentials:'same-origin',
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    const raw=data.error||data.detail||('HTTP '+response.status);
    throw Error(typeof raw==='string'?raw:JSON.stringify(raw));
  }
  return data;
}
