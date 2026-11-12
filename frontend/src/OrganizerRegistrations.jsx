import React, {useRef, useState} from 'react';
import {requestApi, routes} from './api.js';
import './organizer-registrations.css';

const PAGE_SIZE=20;
const STATES=[
  ['','Todos os estados'],
  ['REGISTRADO','Em processamento'],
  ['EM_FILA','Em fila'],
  ['RESERVADO','Reservado'],
  ['EM_VERIFICACAO','Em verificação'],
  ['CONFIRMADO','Confirmado'],
  ['CANCELADO','Cancelado'],
  ['RECUSADO','Recusado'],
  ['EXPIRADO','Expirado'],
  ['SEM_VAGA','Sem vaga']
];
const LABELS=Object.fromEntries(STATES);

/** Consulta privada, paginada e somente leitura de tickets processados.
 * Nenhum CPF, email ou identificador do titular é enviado pelo backend.
 */
export default function OrganizerRegistrations({activityId,title}){
  const [open,setOpen]=useState(false);
  const [filter,setFilter]=useState('');
  const [payload,setPayload]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const requestSeq=useRef(0);

  async function load(estado='',offset=0){
    const seq=++requestSeq.current;
    setBusy(true);setError('');
    try{
      const response=await requestApi(
        routes.activityRegistrations(activityId,{limit:PAGE_SIZE,offset,estado})
      );
      if(requestSeq.current===seq)setPayload(response);
    }catch(e){
      if(requestSeq.current===seq){setError(e.message);setPayload(null);}
    }finally{
      if(requestSeq.current===seq)setBusy(false);
    }
  }
  function toggle(){
    if(open){
      requestSeq.current++;
      setBusy(false);
      setOpen(false);
    }else{
      setOpen(true);
      void load(filter,0);
    }
  }
  const rows=payload?.inscricoes||[];
  const offset=payload?.offset||0;
  const total=payload?.total||0;
  return <div className="eh-manager-reg-list">
    <button type="button" className="eh-outline eh-manager-reg-toggle"
      aria-expanded={open} aria-controls={'eh-regs-'+activityId} onClick={toggle}>
      {open?'Fechar inscrições':'Acompanhar inscrições'}
    </button>
    {open&&<div className="eh-manager-reg-panel" id={'eh-regs-'+activityId}>
      <div className="eh-manager-reg-header">
        <div><h4>Inscrições processadas</h4>
          <p>{title} · somente consulta · ordem de chegada por ticket</p></div>
        <button type="button" className="eh-outline" disabled={busy}
          onClick={()=>load(filter,offset)}>Atualizar</button>
      </div>
      <label htmlFor={'eh-reg-filter-'+activityId}>Filtrar por estado</label>
      <select id={'eh-reg-filter-'+activityId} value={filter} disabled={busy}
        onChange={e=>{
          const next=e.target.value;
          setFilter(next);
          void load(next,0);
        }}>
        {STATES.map(([key,label])=><option key={key} value={key}>{label}</option>)}
      </select>
      {busy&&<p className="eh-manager-muted" role="status">Consultando inscrições…</p>}
      {error&&<p className="eh-organizer-error" role="alert">{error}</p>}
      {!busy&&!error&&payload&&<>
        <p className="eh-manager-reg-count">{total} inscrição(ões) processada(s) neste filtro</p>
        {rows.length===0?<p className="eh-empty-state">Nenhuma inscrição neste estado.</p>:
          <div className="eh-manager-reg-table-wrap">
            <table className="eh-manager-reg-table">
              <caption className="eh-sr-only">Tickets processados de {title}</caption>
              <thead><tr><th scope="col">Ticket</th><th scope="col">Estado</th></tr></thead>
              <tbody>{rows.map(item=><tr key={item.inscricao_id}>
                <td>#{item.numero_ticket}</td>
                <td><span className="eh-manager-reg-state">{LABELS[item.estado]||item.estado}</span></td>
              </tr>)}</tbody>
            </table>
          </div>}
        <div className="eh-manager-reg-pagination">
          <button type="button" className="eh-outline"
            disabled={busy||offset===0} onClick={()=>load(filter,Math.max(0,offset-PAGE_SIZE))}>
            Anterior
          </button>
          <span>{total===0?'0 de 0':(offset+1)+'–'+(offset+rows.length)+' de '+total}</span>
          <button type="button" className="eh-outline"
            disabled={busy||offset+rows.length>=total} onClick={()=>load(filter,offset+PAGE_SIZE)}>
            Próxima
          </button>
        </div>
      </>}
      <p className="eh-manager-reg-note">A lista mostra somente tickets já conciliados no MySQL.
        Solicitações ainda aguardando processamento no SQLite podem não aparecer.
        Nenhum dado pessoal dos participantes é exposto.</p>
    </div>}
  </div>;
}
