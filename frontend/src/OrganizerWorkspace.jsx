import React, {useCallback, useEffect, useState} from 'react';
import {requestApi, routes} from './api.js';
import ScreenHeading from './ScreenHeading.jsx';
import './organizer.css';

/** Dados privados da organizacao. Nunca usa a lista publica como substituto. */
export default function OrganizerWorkspace({user, csrf, onCatalogRefresh}){
  const [events,setEvents]=useState([]);
  const [selectedId,setSelectedId]=useState('');
  const [detail,setDetail]=useState(null);
  const [metrics,setMetrics]=useState({});
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [newTitle,setNewTitle]=useState('');
  const [newDescription,setNewDescription]=useState('');
  const [editingEvent,setEditingEvent]=useState(false);
  const [editTitle,setEditTitle]=useState('');
  const [editDescription,setEditDescription]=useState('');
  const [activityTitle,setActivityTitle]=useState('');
  const [capacity,setCapacity]=useState('20');
  const [paid,setPaid]=useState(false);
  const [price,setPrice]=useState('15,00');
  const [waitlist,setWaitlist]=useState(true);
  const [hold,setHold]=useState('30');
  const [editingActivity,setEditingActivity]=useState('');
  const [activityRename,setActivityRename]=useState('');

  const call=useCallback((path,method='GET',body)=>
    requestApi(path,{method,body,csrf}),[csrf]);

  const reloadEvents=useCallback(async()=>{
    const data=await call(routes.managedEvents);
    setEvents(data.eventos||[]);
    return data.eventos||[];
  },[call]);
  const reloadDetail=useCallback(async(id)=>{
    if(!id)return;
    const data=await call(routes.managedEventActivities(id));
    setDetail(data);
    return data;
  },[call]);

  useEffect(()=>{
    let live=true;
    setLoading(true);
    call(routes.managedEvents).then(data=>{
      if(!live)return;
      setEvents(data.eventos||[]);
      setSelectedId(previous=>previous||data.eventos?.[0]?.id||'');
    }).catch(e=>{if(live)setError(e.message);})
      .finally(()=>{if(live)setLoading(false);});
    return ()=>{live=false;};
  },[call]);
  useEffect(()=>{
    let live=true;
    setDetail(null);setMetrics({});setEditingEvent(false);setEditingActivity('');
    if(!selectedId)return ()=>{live=false;};
    call(routes.managedEventActivities(selectedId)).then(data=>{
      if(!live)return;
      setDetail(data);
      setEditTitle(data.evento?.title||'');
      setEditDescription(data.evento?.description||'');
    }).catch(e=>{if(live)setError(e.message);});
    return ()=>{live=false;};
  },[call,selectedId]);

  async function mutate(action,success){
    setBusy(true);setError('');setNotice('');
    try{
      await action();
      if(success)setNotice(success);
    }catch(e){setError(e.message);}
    finally{setBusy(false);}
  }
  function selectEvent(id){
    setError('');setNotice('');setSelectedId(id);
  }
  async function createEvent(e){
    e.preventDefault();
    await mutate(async()=>{
      const result=await call(routes.events,'POST',{
        titulo:newTitle,descricao:newDescription
      });
      setNewTitle('');setNewDescription('');
      await reloadEvents();
      setSelectedId(result.evento_id);
    },'Evento criado. Cadastre a primeira atividade para publicá-lo.');
  }
  async function updateEvent(e){
    e.preventDefault();
    await mutate(async()=>{
      await call(routes.editEvent(selectedId),'PATCH',{
        titulo:editTitle,descricao:editDescription
      });
      await Promise.all([reloadEvents(),reloadDetail(selectedId)]);
      onCatalogRefresh?.().catch(()=>{});
      setEditingEvent(false);
    },'Dados do evento atualizados.');
  }
  async function createActivity(e){
    e.preventDefault();
    await mutate(async()=>{
      const cents=paid?Math.round(Number(price.replace(',','.'))*100):0;
      if(!Number.isInteger(cents)||(paid&&cents<=0))
        throw new Error('Informe um preço válido, maior que zero.');
      const result=await call(routes.eventActivities(selectedId),'POST',{
        titulo:activityTitle,capacidade:Number(capacity),
        gratuita:!paid,preco_centavos:cents,
        lista_espera_habilitada:waitlist,prazo_reserva_min:Number(hold)
      });
      setActivityTitle('');setMetrics({});
      await Promise.all([reloadEvents(),reloadDetail(selectedId)]);
      if(result.publicada)onCatalogRefresh?.().catch(()=>{});
      setNotice(result.publicada?
        'Atividade publicada com a capacidade sincronizada.':
        'Atividade registrada, mas a publicação está pendente de sincronização.');
    },'');
  }
  async function renameActivity(e,id){
    e.preventDefault();
    await mutate(async()=>{
      await call(routes.editActivity(id),'PATCH',{titulo:activityRename});
      await reloadDetail(selectedId);
      onCatalogRefresh?.().catch(()=>{});
      setEditingActivity('');
    },'Título da atividade atualizado.');
  }
  async function synchronizeActivity(id){
    await mutate(async()=>{
      const result=await call(routes.synchronizeActivity(id),'POST',{});
      await Promise.all([reloadEvents(),reloadDetail(selectedId)]);
      if(result.sincronizacao==='CONCLUIDA')onCatalogRefresh?.().catch(()=>{});
      setNotice(result.sincronizacao==='CONCLUIDA'?
        'Publicação sincronizada.':'Sincronização ainda pendente; tente novamente mais tarde.');
    },'');
  }
  async function loadMetrics(id){
    setError('');
    try{
      const result=await call(routes.activitySummary(id));
      setMetrics(old=>({...old,[id]:result.resumo||null}));
    }catch(e){setError('Não foi possível consultar a ocupação: '+e.message);}
  }

  const selected=events.find(e=>e.id===selectedId);
  const activities=detail?.atividades||[];
  return <section className="eh-panel eh-organizer" id="organizacao">
    <ScreenHeading eyebrow="GESTÃO DE EVENTOS" title="Seu espaço de organização"
      description="Crie, edite e acompanhe as atividades da sua organização. Rascunhos e sincronizações pendentes ficam visíveis somente para quem gerencia o evento."/>
    {notice&&<p className="eh-organizer-feedback" role="status">{notice}</p>}
    {error&&<p className="eh-organizer-error" role="alert">{error}</p>}
    <div className="eh-manager-layout">
      <aside className="eh-manager-sidebar" aria-label="Eventos da organização">
        <div className="eh-manager-sidebar-header">
          <h3>{user?.role==='admin'?'Eventos gerenciáveis':'Eventos da organização'}</h3>
          <button type="button" className="eh-outline" disabled={busy} onClick={()=>
            reloadEvents().catch(e=>setError(e.message))}>Atualizar</button>
        </div>
        {loading&&<p className="eh-manager-muted">Carregando eventos…</p>}
        {!loading&&events.length===0&&<p className="eh-manager-muted">Ainda não há eventos nesta organização.</p>}
        <div className="eh-manager-event-list">
          {events.map(ev=><button type="button" key={ev.id}
            className={'eh-manager-event'+(selectedId===ev.id?' is-selected':'')}
            onClick={()=>selectEvent(ev.id)} aria-pressed={selectedId===ev.id}>
            <strong>{ev.title}</strong>
            <small>{ev.atividades_publicadas} publicadas · {ev.atividades_pendentes} pendentes</small>
          </button>)}
        </div>
        <form className="eh-editor-form eh-manager-create" onSubmit={createEvent}>
          <h3>Criar novo evento</h3>
          <label htmlFor="eh-new-event-title">Título do evento</label>
          <input id="eh-new-event-title" value={newTitle} minLength={3} maxLength={160}
            onChange={e=>setNewTitle(e.target.value)} required/>
          <label htmlFor="eh-new-event-description">Descrição (opcional)</label>
          <textarea id="eh-new-event-description" maxLength={4000} rows={3}
            value={newDescription} onChange={e=>setNewDescription(e.target.value)}/>
          <button type="submit" disabled={busy}>Criar evento</button>
        </form>
      </aside>
      <div className="eh-manager-details">
        {!selectedId&&<div className="eh-empty-state">Selecione um evento ou crie o primeiro para começar.</div>}
        {selectedId&&!detail&&<p className="eh-manager-muted">Carregando detalhes do evento…</p>}
        {detail&&<>
          <div className="eh-manager-event-header">
            <div>
              <span className="eh-manager-caption">EVENTO DA ORGANIZAÇÃO</span>
              <h3>{detail.evento.title}</h3>
              <p>{detail.evento.description||'Sem descrição cadastrada.'}</p>
            </div>
            <button type="button" className="eh-outline" disabled={busy} onClick={()=>{
              setEditTitle(detail.evento.title);
              setEditDescription(detail.evento.description||'');
              setEditingEvent(!editingEvent);
            }}>{editingEvent?'Fechar edição':'Editar evento'}</button>
          </div>
          {editingEvent&&<form className="eh-editor-form eh-manager-edit" onSubmit={updateEvent}>
            <label htmlFor="eh-edit-event-title">Título</label>
            <input id="eh-edit-event-title" required minLength={3} maxLength={160}
              value={editTitle} onChange={e=>setEditTitle(e.target.value)}/>
            <label htmlFor="eh-edit-event-desc">Descrição</label>
            <textarea id="eh-edit-event-desc" rows={4} maxLength={4000}
              value={editDescription} onChange={e=>setEditDescription(e.target.value)}/>
            <button disabled={busy} type="submit">Salvar alterações</button>
          </form>}
          <div className="eh-manager-section-title">
            <div><span className="eh-manager-caption">PROGRAMAÇÃO</span>
              <h3>Atividades ({activities.length})</h3></div>
          </div>
          {activities.length===0&&<p className="eh-empty-state">
            O evento ainda não possui atividades. Cadastre uma abaixo para iniciar a publicação.
          </p>}
          <div className="eh-manager-activities">
            {activities.map(a=><article className="eh-manager-activity" key={a.atividade_id}>
              <div className="eh-manager-activity-top">
                <strong>{a.titulo}</strong>
                <span className={'eh-manager-status '+(a.publicada?'is-published':'is-pending')}>
                  {a.publicada?'Publicada':'Pendente'}
                </span>
              </div>
              <p>{a.capacidade} vagas · {a.gratuita?'Gratuita':'R$ '+(a.preco_centavos/100).toFixed(2)}
                · {a.lista_espera_habilitada?'Fila habilitada':'Sem fila'}</p>
              <div className="eh-manager-actions">
                <button type="button" className="eh-outline" disabled={busy}
                  onClick={()=>{setEditingActivity(editingActivity===a.atividade_id?'':a.atividade_id);setActivityRename(a.titulo);}}>
                  {editingActivity===a.atividade_id?'Fechar edição':'Editar título'}</button>
                {a.publicada?<button type="button" className="eh-outline" disabled={busy}
                    onClick={()=>loadMetrics(a.atividade_id)}>Ver ocupação</button>:
                  <button type="button" disabled={busy}
                    onClick={()=>synchronizeActivity(a.atividade_id)}>Tentar publicar</button>}
              </div>
              {editingActivity===a.atividade_id&&<form className="eh-manager-rename" onSubmit={e=>renameActivity(e,a.atividade_id)}>
                <label htmlFor={'rename-'+a.atividade_id}>Novo título da atividade</label>
                <input id={'rename-'+a.atividade_id} value={activityRename} required
                  minLength={3} maxLength={160} onChange={e=>setActivityRename(e.target.value)}/>
                <button type="submit" disabled={busy}>Salvar título</button>
              </form>}
              {Object.hasOwn(metrics,a.atividade_id)&&metrics[a.atividade_id]&&
                <div className="eh-manager-metrics" aria-label={'Ocupação de '+a.titulo}>
                  <div><strong>{metrics[a.atividade_id].ocupadas}</strong><span>Vagas ocupadas</span></div>
                  <div><strong>{metrics[a.atividade_id].capacidade}</strong><span>Capacidade</span></div>
                  <div><strong>{metrics[a.atividade_id].confirmadas}</strong><span>Confirmadas</span></div>
                  <div><strong>{metrics[a.atividade_id].em_fila}</strong><span>Na fila</span></div>
                  <p>Reservadas: {metrics[a.atividade_id].reservadas} · Em verificação: {metrics[a.atividade_id].em_verificacao} · Processando: {metrics[a.atividade_id].em_processamento}</p>
                </div>}
            </article>)}
          </div>
          <form className="eh-editor-form eh-manager-create-activity" onSubmit={createActivity}>
            <h3>Adicionar atividade</h3>
            <div className="eh-manager-fields">
              <div><label htmlFor="eh-new-activity-title">Nome da atividade</label>
                <input id="eh-new-activity-title" value={activityTitle} required minLength={3}
                  maxLength={160} onChange={e=>setActivityTitle(e.target.value)}/></div>
              <div><label htmlFor="eh-new-activity-capacity">Quantidade de vagas</label>
                <input id="eh-new-activity-capacity" type="number" value={capacity} min={0}
                  max={100000} required onChange={e=>setCapacity(e.target.value)}/></div>
              <div><label htmlFor="eh-new-activity-hold">Reserva (minutos)</label>
                <input id="eh-new-activity-hold" type="number" min={1} max={1440}
                  value={hold} required onChange={e=>setHold(e.target.value)}/></div>
              {paid&&<div><label htmlFor="eh-new-activity-price">Valor (R$)</label>
                <input id="eh-new-activity-price" value={price} required
                  onChange={e=>setPrice(e.target.value)} inputMode="decimal"/></div>}
            </div>
            <label className="eh-manager-check"><input type="checkbox" checked={paid}
              onChange={e=>setPaid(e.target.checked)}/> Atividade paga (simulação)</label>
            <label className="eh-manager-check"><input type="checkbox" checked={waitlist}
              onChange={e=>setWaitlist(e.target.checked)}/> Habilitar lista de espera</label>
            <p className="eh-manager-muted">A capacidade é definida na criação e sincronizada com Inscrições.
              A alteração posterior de vagas exige um contrato versionado, ainda não disponibilizado nesta tela.</p>
            <button disabled={busy} type="submit">Criar e publicar atividade</button>
          </form>
        </>}
      </div>
    </div>
  </section>;
}
