import React, {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import './theme.css';
import EventHubMark from './EventHubMark.jsx';

function App(){
  const [user,setUser]=useState(null);
  const [csrf,setCsrf]=useState('');
  const [mode,setMode]=useState('login');
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [message,setMessage]=useState('');
  const [events,setEvents]=useState([]);
  const [activities,setActivities]=useState({});
  const [eventTitle,setEventTitle]=useState('');
  const [newEventId,setNewEventId]=useState('');
  const [activityTitle,setActivityTitle]=useState('');
  const [capacity,setCapacity]=useState('2');
  const [paid,setPaid]=useState(false);
  const [cpf,setCpf]=useState('');
  const [selected,setSelected]=useState('');
  const [myTickets,setMyTickets]=useState([]);
  const [notifications,setNotifications]=useState([]);

  async function api(path,method='GET',body,idem){
    const headers={};
    if(body!==undefined) headers['Content-Type']='application/json';
    if(csrf && method!=='GET') headers['X-CSRF-Token']=csrf;
    if(idem) headers['Idempotency-Key']=idem;
    const response=await fetch('/api'+path,{
      method,headers,credentials:'same-origin',
      body:body===undefined?undefined:JSON.stringify(body)
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(data.error||data.detail||'HTTP '+response.status);
    return data;
  }
  async function refreshEvents(){
    const data=await api('/eventos');
    setEvents(data.eventos||[]);
  }
  useEffect(()=>{
    fetch('/api/auth/me',{credentials:'same-origin'}).then(async r=>{
      if(r.ok){const x=await r.json();setUser(x.user);setCsrf(x.csrf);}
    }).catch(()=>{});
    fetch('/api/eventos').then(r=>r.json()).then(x=>setEvents(x.eventos||[])).catch(()=>{});
  },[]);
  // Inscricoes pertencem a conta, nunca somente ao estado da sessao.
  async function loadTickets(){
    const data=await api('/inscricoes?limit=50');
    setMyTickets(data.inscricoes||[]);
  }
  useEffect(()=>{
    if(!user?.id){setMyTickets([]);return;}
    let active=true;
    fetch('/api/inscricoes?limit=50',{credentials:'same-origin'})
      .then(async response=>{
        if(!response.ok) throw Error('Nao foi possivel carregar suas inscricoes.');
        return response.json();
      })
      .then(data=>{if(active)setMyTickets(data.inscricoes||[]);})
      .catch(err=>{if(active)setMessage(err.message);});
    return ()=>{active=false;};
  },[user?.id]);
  async function login(evt){
    evt.preventDefault();setMessage('');
    try{
      if(mode==='register'){
        await api('/auth/register','POST',{email,password});
        setMode('login');
        setMessage('Conta criada. Entre com suas credenciais.');
        return;
      }
      const data=await api('/auth/login','POST',{email,password});
      setUser(data.user);setCsrf(data.csrf);setPassword('');
      setMessage('Sessao autenticada.');
      await refreshEvents();
    }catch(e){setMessage(e.message);}
  }
  async function logout(){
    try{await api('/auth/logout','POST',{});}catch{}
    setUser(null);setCsrf('');setMyTickets([]);setMessage('Sessao encerrada.');
  }
  async function createEvent(evt){
    evt.preventDefault();
    try{
      const r=await api('/eventos','POST',{titulo:eventTitle});
      setNewEventId(r.evento_id);setMessage('Evento criado. Cadastre uma atividade.');
    }catch(e){setMessage(e.message);}
  }
  async function createActivity(evt){
    evt.preventDefault();
    try{
      const r=await api('/eventos/'+newEventId+'/atividades','POST',{
        titulo:activityTitle,capacidade:Number(capacity),
        gratuita:!paid,preco_centavos:paid?1500:0,
        lista_espera_habilitada:true,prazo_reserva_min:30
      });
      setMessage(r.publicada?'Atividade publicada e sincronizada.':'Sincronizacao pendente. Tente novamente.');
      if(r.publicada){await refreshEvents();await loadActivities(newEventId);}
    }catch(e){setMessage(e.message);}
  }
  async function loadActivities(id){
    try{
      const data=await api('/eventos/'+id+'/atividades');
      setActivities(old=>({...old,[id]:data.atividades||[]}));
    }catch(e){setMessage(e.message);}
  }
  async function register(evt){
    evt.preventDefault();
    try{
      const data=await api('/inscricoes','POST',
        {atividade_id:selected,cpf},crypto.randomUUID());
      setMyTickets(old=>old.some(t=>t.inscricao_id===data.inscricao_id)
        ?old:[{...data},...old]);
      setMessage(data.mensagem);
      await loadTickets().catch(()=>{});
    }catch(e){setMessage(e.message);}
  }
  async function refreshTicket(id){
    try{
      const data=await api('/inscricoes/'+id);
      setMyTickets(old=>old.map(item=>item.inscricao_id===id?{...item,...data}:item));
    }catch(e){setMessage(e.message);}
  }
  async function cancelTicket(id){
    try{
      const result=await api('/inscricoes/'+id+'/cancelar','POST',{});
      await loadTickets();
      setMessage('Inscricao atualizada: '+result.estado);
    }catch(e){setMessage(e.message);}
  }
  async function loadNotifications(){
    try{
      const data=await api('/notificacoes');
      setNotifications(data.notificacoes||[]);
    }catch(e){setMessage(e.message);}
  }
  async function simulatePayment(id, outcome){
    try{
      const result=await api('/pagamentos/'+id+'/simular',
        'POST',{resultado:outcome},crypto.randomUUID());
      setMessage('Simulacao '+outcome+': '+(result.estado_inscricao||result.error||'PENDENTE'));
      await refreshTicket(id);
    }catch(e){setMessage(e.message);}
  }
  const organizer=user && ['organizer','admin'].includes(user.role);
  const participant=user && ['participant','admin'].includes(user.role);
  const box={border:'1px solid #d5dfe8',borderRadius:12,padding:20,background:'#fff'};
  const input={display:'block',width:'100%',padding:10,margin:'5px 0 12px',borderRadius:6,border:'1px solid #bac7d6',boxSizing:'border-box'};
  const button={border:0,borderRadius:7,padding:'10px 14px',background:'#164f78',color:'white',cursor:'pointer',marginRight:8};
  return <main className="eh-app" style={{fontFamily:'system-ui, sans-serif',background:'#f3f6f8',minHeight:'100vh',color:'#203749',padding:28}}>
    <div className="eh-shell">
      {user&&<nav className="eh-sitebar" aria-label="Navegação principal">
        <a className="eh-brand" href="#visao-geral" aria-label="EventHub — início"><span className="eh-brand-symbol"><EventHubMark size={45}/></span><span className="eh-brand-word">Event<span>Hub</span></span></a>
        <div className="eh-nav-tabs">
          <a className="eh-nav-link is-current" href="#visao-geral">Início</a>
          <a className="eh-nav-link" href="#eventos">Explorar eventos</a>
          {organizer&&<a className="eh-nav-link" href="#organizacao">Organizar</a>}
          {participant&&<a className="eh-nav-link" href="#inscricao">Minhas inscrições</a>}
          <a className="eh-nav-link" href="#notificacoes">Atualizações</a>
        </div>
        <span className="eh-user-chip" title={'Perfil: '+user.role}>● <span>Meu espaço</span></span>
      </nav>}
      <div className="eh-main">
        <header className="eh-topbar">
          <div><span className="eh-heading-overline">EVENTHUB / WORKSPACE</span><h1>{user?'Painel de eventos':'EventHub'}</h1><p>Plataforma de eventos, programacao e inscricoes</p></div>
          {user&&<button className="eh-outline" style={button} onClick={logout}>Sair</button>}
        </header>
        <div className="eh-page" id="visao-geral">
          {user&&<section className="eh-feature" aria-label="Destaque">
            <div className="eh-feature-copy">
              <span className="eh-kicker"><span className="eh-kicker-dot"></span> CONECTE PESSOAS E EXPERIÊNCIAS</span>
              <h2>{organizer?<>Eventos que <em>acontecem.</em><br/><span className="eh-headline-strong">Histórias que ficam.</span></>:<>Sua próxima <em>experiência</em><br/>começa aqui.</>}</h2>
              <p>{organizer?'Um espaço para criar, publicar e acompanhar seus eventos sem perder o essencial: as pessoas.':'Descubra encontros, atividades e novas possibilidades. Tudo em um só lugar.'}</p>
              <a className="eh-hero-cta" href={organizer?'#organizacao':'#eventos'}>{organizer?'Criar um evento':'Explorar eventos'} <span aria-hidden="true">↗</span></a>
            </div>
            <div className="eh-spotlight" aria-label="Evento em destaque">
              <div className="eh-spotlight-art"><span className="eh-orbit orbit-a"></span><span className="eh-orbit orbit-b"></span><span className="eh-spark">✳</span></div>
              <span className="eh-spotlight-label">✦ EM DESTAQUE</span>
              <strong>{events.length?events[0].title:'Seu próximo evento merece destaque.'}</strong>
              <span className="eh-spotlight-meta">{events.length?String(events[0].atividades||0)+' atividades publicadas':'A vitrine das experiências começa aqui.'}</span>
              <a href="#eventos">Ver catálogo <span aria-hidden="true">↗</span></a>
            </div>
          </section>}
          {user&&<div className="eh-stats">
            <div className="eh-stat"><span className="eh-stat-mark">▦</span><span className="eh-stat-label">Eventos publicados</span><strong className="eh-stat-number">{events.length}</strong><span className="eh-stat-hint">Visíveis no catálogo</span></div>
            <div className="eh-stat"><span className="eh-stat-mark">◫</span><span className="eh-stat-label">Atividades publicadas</span><strong className="eh-stat-number">{events.reduce((total,ev)=>total+Number(ev.atividades||0),0)}</strong><span className="eh-stat-hint">Total anunciado pelos eventos</span></div>
            {participant&&<div className="eh-stat"><span className="eh-stat-mark">♧</span><span className="eh-stat-label">Minhas inscrições recentes</span><strong className="eh-stat-number">{myTickets.length}</strong><span className="eh-stat-hint">Até 50 carregadas</span></div>}
          </div>}
          {message&&<p className="eh-notice" role="status" style={{...box,background:'#eaf1f6'}}>{message}</p>}
      {!user&&<section className="eh-panel" style={{...box,maxWidth:460,margin:'0 auto'}}>
        <h2>{mode==='login'?'Entrar':'Criar conta de participante'}</h2>
        <form onSubmit={login}>
          <label>E-mail<input style={input} type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
          <label>Senha (minimo 12 caracteres)<input style={input} type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength="12"/></label>
          <button style={button} type="submit">{mode==='login'?'Entrar':'Cadastrar'}</button>
          <button style={{...button,background:'#5e7080'}} type="button" onClick={()=>setMode(mode==='login'?'register':'login')}>
            {mode==='login'?'Criar conta':'Voltar ao login'}
          </button>
        </form>
      </section>}
      {user?.org_id&&<p className="eh-footer">Organização vinculada: {user.org_id}</p>}
      {organizer&&<section id="organizacao" className="eh-panel" style={box}>
        <h2>Organizacao de atividades</h2>
        <form onSubmit={createEvent}>
          <label>Titulo do evento<input style={input} value={eventTitle} onChange={e=>setEventTitle(e.target.value)} minLength="3" required/></label>
          <button style={button}>Criar evento</button>
        </form>
        {newEventId&&<form onSubmit={createActivity} style={{marginTop:24,paddingTop:12,borderTop:'1px solid #ddd'}}>
          <p>Evento: {newEventId}</p>
          <label>Titulo da atividade<input style={input} value={activityTitle} onChange={e=>setActivityTitle(e.target.value)} minLength="3" required/></label>
          <label>Vagas<input style={input} type="number" min="0" max="100000" value={capacity} onChange={e=>setCapacity(e.target.value)} required/></label>
          <label><input type="checkbox" checked={paid} onChange={e=>setPaid(e.target.checked)}/> Atividade paga (valor demonstrativo: R$ 15)</label>
          <p><button style={button}>Criar e sincronizar atividade</button></p>
        </form>}
      </section>}
      <section id="eventos" className="eh-panel" style={{...box,marginTop:18}}>
        <h2>Eventos publicados</h2>
        <button style={button} onClick={()=>refreshEvents().catch(e=>setMessage(e.message))}>Atualizar lista</button>
        {!events.length&&<p>Nenhum evento com atividade publicada.</p>}
        {events.map(ev=><div className="eh-event-item" key={ev.id} style={{borderTop:'1px solid #ddd',marginTop:12,paddingTop:12}}>
          <strong>{ev.title}</strong> • {ev.atividades} atividades
          <p><button style={button} onClick={()=>loadActivities(ev.id)}>Ver atividades</button></p>
          {(activities[ev.id]||[]).map(a=><p className="eh-activity-item" key={a.atividade_id} style={{padding:8,background:'#f0f5f8'}}>
            {a.titulo} • {a.capacidade} vagas • {a.gratuita?'gratuita':'R$ '+(a.preco_centavos/100).toFixed(2)}
            {participant&&<button style={{...button,marginLeft:12}} onClick={()=>setSelected(a.atividade_id)}>Selecionar</button>}
          </p>)}
        </div>)}
      </section>
      {participant&&<section id="inscricao" className="eh-panel" style={{...box,marginTop:18}}>
        <h2>Inscricao</h2>
        <form onSubmit={register}>
          <label>Atividade selecionada<input style={input} value={selected} onChange={e=>setSelected(e.target.value)} required/></label>
          <label>CPF do participante<input style={input} value={cpf} onChange={e=>setCpf(e.target.value)} required/></label>
          <button style={button}>Solicitar vaga</button>
        </form>
        <h3>Minhas inscricoes</h3>
        <p>Historico vinculado a sua conta, inclusive apos sair e entrar novamente.</p>
        <button style={{...button,background:'#48677a'}} onClick={()=>loadTickets().catch(e=>setMessage(e.message))}>Atualizar inscricoes</button>
        {!myTickets.length&&<p>Nenhuma inscricao encontrada.</p>}
        {myTickets.map(t=><p className="eh-ticket-row" key={t.inscricao_id}>
          <strong>Ticket {t.numero_ticket}</strong> — {t.estado}
          <button style={{...button,marginLeft:8}} onClick={()=>refreshTicket(t.inscricao_id)}>Consultar</button>
          {['RESERVADO','EM_FILA','CONFIRMADO'].includes(t.estado)&&
            <button style={{...button,background:'#8d4851'}} onClick={()=>cancelTicket(t.inscricao_id)}>Cancelar inscricao</button>}
          {t.estado==='RESERVADO'&&<span style={{display:'inline-flex',gap:6,flexWrap:'wrap',marginTop:8}}>
            <button style={button} onClick={()=>simulatePayment(t.inscricao_id,'PAGO')}>Simular aprovado</button>
            <button style={button} onClick={()=>simulatePayment(t.inscricao_id,'RECUSADO_DEFINITIVO')}>Simular recusa</button>
            <button style={button} onClick={()=>simulatePayment(t.inscricao_id,'INDETERMINADO')}>Simular incerteza</button>
          </span>}
        </p>)}
      </section>}
      {user&&<section id="notificacoes" className="eh-panel" style={{...box,marginTop:18}}>
        <h2>Minhas notificacoes</h2>
        <p>Eventos persistidos e entregues em modo simulacao, sem envio de e-mail.</p>
        <button style={button} onClick={loadNotifications}>Atualizar notificacoes</button>
        {!notifications.length&&<p>Nenhuma notificacao carregada.</p>}
        {notifications.map(n=><p key={n.event_id} style={{borderTop:'1px solid #ddd',paddingTop:8}}>
          Inscricao {n.inscricao_id.slice(0,8)} • <strong>{n.estado_inscricao}</strong> • {n.entrega}
        </p>)}
      </section>}
          <p className="eh-footer" style={{color:'#718593',fontSize:13,marginTop:24}}>Ambiente de validacao: pagamentos e notificacoes ainda sao simulados, sem transacoes financeiras ou e-mails reais. Capacidade e fila contam com testes de contingencia; nenhuma operacao de producao esta habilitada.</p>
        </div>
      </div>
    </div>
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
