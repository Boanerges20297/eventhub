import React, {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import './theme.css';
import EventHubMark from './EventHubMark.jsx';
import {requestApi,routes} from './api.js';
import ScreenHeading from './ScreenHeading.jsx';
import OrganizerWorkspace from './OrganizerWorkspace.jsx';

function App(){
  const [user,setUser]=useState(null);
  const [csrf,setCsrf]=useState('');
  const [mode,setMode]=useState('login');
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [otpChallenge,setOtpChallenge]=useState('');
  const [otpCode,setOtpCode]=useState('');
  const [simulationCode,setSimulationCode]=useState('');
  const [trustDevice,setTrustDevice]=useState(false);
  const [message,setMessage]=useState('');
  const [events,setEvents]=useState([]);
  const [eventQuery,setEventQuery]=useState('');
  const [activities,setActivities]=useState({});
  const [cpf,setCpf]=useState('');
  const [selected,setSelected]=useState('');
  const [myTickets,setMyTickets]=useState([]);
  const [notifications,setNotifications]=useState([]);
  const [notificationsLoaded,setNotificationsLoaded]=useState(false);
  const [activeView,setActiveView]=useState('visao-geral');
  const [mobileMenuOpen,setMobileMenuOpen]=useState(false);
  const menuRef=useRef(null);
  const menuButtonRef=useRef(null);
  const restoreMenuFocusRef=useRef(true);

  useEffect(()=>{
    const pages=new Set(['visao-geral','eventos','organizacao','inscricao','notificacoes']);
    const onHash=()=>{
      const next=window.location.hash.slice(1);
      if(pages.has(next))setActiveView(next);
    };
    onHash();
    window.addEventListener('hashchange',onHash);
    return ()=>window.removeEventListener('hashchange',onHash);
  },[]);
  useEffect(()=>{
    if(!mobileMenuOpen)return;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const drawer=menuRef.current;
    drawer?.querySelector('button')?.focus();
    function keyHandler(event){
      if(event.key==='Escape'){
        event.preventDefault();
        setMobileMenuOpen(false);
      }
      if(event.key==='Tab' && drawer){
        const focusables=Array.from(drawer.querySelectorAll('button:not([disabled]),a[href]'));
        if(!focusables.length)return;
        const first=focusables[0],last=focusables[focusables.length-1];
        if(event.shiftKey && document.activeElement===first){
          event.preventDefault();last.focus();
        }else if(!event.shiftKey && document.activeElement===last){
          event.preventDefault();first.focus();
        }
      }
    }
    const resizeHandler=()=>{if(window.innerWidth>700)setMobileMenuOpen(false);};
    document.addEventListener('keydown',keyHandler);
    window.addEventListener('resize',resizeHandler);
    return ()=>{
      document.body.style.overflow=previousOverflow;
      document.removeEventListener('keydown',keyHandler);
      window.removeEventListener('resize',resizeHandler);
      if(restoreMenuFocusRef.current)menuButtonRef.current?.focus();
    };
  },[mobileMenuOpen]);

  function api(path,method='GET',body,idem){
    return requestApi(path,{method,body,csrf,idempotencyKey:idem});
  }
  async function refreshEvents(){
    const data=await api('/eventos');
    setEvents(data.eventos||[]);
  }
  useEffect(()=>{
    requestApi(routes.session).then(x=>{setUser(x.user);setCsrf(x.csrf);}).catch(()=>{});
    requestApi(routes.events).then(x=>setEvents(x.eventos||[])).catch(()=>{});
  },[]);
  // Inscricoes pertencem a conta, nunca somente ao estado da sessao.
  async function loadTickets(){
    const data=await api('/inscricoes?limit=50');
    setMyTickets(data.inscricoes||[]);
  }
  useEffect(()=>{
    if(!user?.id){setMyTickets([]);return;}
    let active=true;
    requestApi(routes.myRegistrations(50))
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
      if(mode==='verify'){
        const data=await api('/auth/verify','POST',{
          challenge_id:otpChallenge,code:otpCode,trust_device:trustDevice});
        setUser(data.user);setCsrf(data.csrf);
        setOtpCode('');setSimulationCode('');setOtpChallenge('');setTrustDevice(false);setMode('login');
        setMessage('Acesso confirmado com segundo fator.');
        await refreshEvents();
        return;
      }
      const data=await api('/auth/login','POST',{email,password});
      setPassword('');
      if(data.otp_required){
        setOtpChallenge(data.challenge_id);setOtpCode('');setTrustDevice(false);
        setSimulationCode(data.simulation===true && /^[0-9]{6}$/.test(data.simulation_code||'') ? data.simulation_code : '');
        setMode('verify');
        setMessage(data.simulation && data.simulation_code
          ? 'Teste local: use Preencher codigo de teste e depois Confirmar OTP.'
          : 'Informe o codigo de verificacao.');
        return;
      }
      setUser(data.user);setCsrf(data.csrf);
      setMessage('Acesso realizado em dispositivo confiavel.');
      await refreshEvents();
    }catch(e){setMessage(e.message);}
  }
  async function logout(){
    try{
      await api('/auth/logout','POST',{});
      setUser(null);setCsrf('');setMyTickets([]);setMessage('Sessao revogada e encerrada.');
    }catch(e){setMessage('Nao foi possivel confirmar a revogacao: '+e.message);}
  }
  async function forgetDevice(){
    try{
      await api('/auth/device/revoke','POST',{});
      setMessage('Este dispositivo nao e mais confiavel. Um novo login exigira OTP.');
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
      setNotificationsLoaded(true);
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
  const navLinks=[
    {id:'visao-geral',label:'Início'},
    {id:'eventos',label:'Explorar eventos'},
    ...(organizer?[{id:'organizacao',label:'Organizar'}]:[]),
    ...(participant?[{id:'inscricao',label:'Minhas inscrições'}]:[]),
    {id:'notificacoes',label:'Atualizações'}
  ];
  const availableActivities=Object.values(activities).flat();
  const visibleEvents=events.filter(ev=>
    String(ev.title||'').toLocaleLowerCase('pt-BR')
      .includes(eventQuery.trim().toLocaleLowerCase('pt-BR'))
  );
  function goView(id){
    if(mobileMenuOpen)restoreMenuFocusRef.current=false;
    setActiveView(id);
    setMobileMenuOpen(false);
    if(window.location.hash!=='#'+id)window.location.hash=id;
  }
  const box={border:'1px solid #d5dfe8',borderRadius:12,padding:20,background:'#fff'};
  const input={display:'block',width:'100%',padding:10,margin:'5px 0 12px',borderRadius:6,border:'1px solid #bac7d6',boxSizing:'border-box'};
  const button={border:0,borderRadius:7,padding:'10px 14px',background:'#164f78',color:'white',cursor:'pointer',marginRight:8};
  return <main className="eh-app" style={{fontFamily:'system-ui, sans-serif',background:'#f3f6f8',minHeight:'100vh',color:'#203749',padding:28}}>
    <div className="eh-shell">
      {user&&<nav className="eh-sitebar" aria-label="Navegação principal">
        <div className="eh-mobile-brand-row">
          <button className="eh-menu-toggle" type="button" ref={menuButtonRef}
            aria-label="Abrir menu de navegação" aria-controls="eh-mobile-drawer"
            aria-expanded={mobileMenuOpen} onClick={()=>{restoreMenuFocusRef.current=true;setMobileMenuOpen(true);}}>
            <span className="eh-menu-bars" aria-hidden="true"><i/><i/><i/></span>
          </button>
          <a className="eh-brand" href="#visao-geral" aria-label="EventHub — início" onClick={()=>goView('visao-geral')}><span className="eh-brand-symbol"><EventHubMark size={45}/></span><span className="eh-brand-word">Event<span>Hub</span></span></a>
        </div>
        <div className="eh-nav-tabs">
          {navLinks.map(link=><a key={link.id}
            className={'eh-nav-link'+(activeView===link.id?' is-current':'')}
            aria-current={activeView===link.id?'page':undefined}
            href={'#'+link.id} onClick={()=>goView(link.id)}>{link.label}</a>)}
        </div>
        <span className="eh-user-chip" title={'Perfil: '+user.role}>● <span>Meu espaço</span></span>
      </nav>}
      {user&&mobileMenuOpen&&<div className="eh-mobile-menu-layer" id="eh-mobile-drawer">
        <button className="eh-drawer-backdrop" type="button" aria-label="Fechar menu ao tocar fora"
          onClick={()=>setMobileMenuOpen(false)}/>
        <aside className="eh-drawer" ref={menuRef} role="dialog" aria-modal="true"
          aria-labelledby="eh-drawer-title">
          <div className="eh-drawer-header">
            <span id="eh-drawer-title" className="eh-drawer-brand"><EventHubMark size={40}/> Event<span>Hub</span></span>
            <button className="eh-drawer-close" type="button" onClick={()=>setMobileMenuOpen(false)}
              aria-label="Fechar menu">×</button>
          </div>
          <p className="eh-drawer-caption">SEU ESPAÇO DE EVENTOS</p>
          <nav className="eh-drawer-links" aria-label="Navegação móvel">
            {navLinks.map((link,i)=><a key={link.id}
              className={'eh-drawer-link'+(activeView===link.id?' is-current':'')}
              aria-current={activeView===link.id?'page':undefined}
              href={'#'+link.id} onClick={()=>goView(link.id)}>
              <span className="eh-drawer-link-index">{String(i+1).padStart(2,'0')}</span>
              {link.label}<span className="eh-drawer-link-arrow" aria-hidden="true">↗</span>
            </a>)}
          </nav>
          <div className="eh-drawer-footer">
            <button className="eh-drawer-logout" type="button"
              onClick={()=>{setMobileMenuOpen(false);logout();}}>Sair da conta <span aria-hidden="true">↗</span></button>
            <p>EventHub <span>•</span> Conectando experiências</p>
          </div>
        </aside>
      </div>}
      <div className="eh-main">
        <header className={'eh-topbar'+(user?' eh-auth-topbar':'')}>
          <div><span className="eh-heading-overline">EVENTHUB / WORKSPACE</span><h1>{user?'Painel de eventos':'EventHub'}</h1><p>Plataforma de eventos, programacao e inscricoes</p></div>
          {user&&<div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button className="eh-outline" style={button} onClick={forgetDevice}>Esquecer aparelho</button><button className="eh-outline" style={button} onClick={logout}>Sair</button></div>}
        </header>
        <div className="eh-page" id="visao-geral">
          {user&&activeView==='visao-geral'&&<section className="eh-feature" aria-label="Destaque">
            <div className="eh-feature-copy">
              <span className="eh-kicker"><span className="eh-kicker-dot"></span> CONECTE PESSOAS E EXPERIÊNCIAS</span>
              <h2>{organizer?<>Eventos que <em>acontecem.</em><br/><span className="eh-headline-strong">Histórias que ficam.</span></>:<>Sua próxima <em>experiência</em><br/>começa aqui.</>}</h2>
              <p>{organizer?'Um espaço para criar, publicar e acompanhar seus eventos sem perder o essencial: as pessoas.':'Descubra encontros, atividades e novas possibilidades. Tudo em um só lugar.'}</p>
              <a className="eh-hero-cta" href={organizer?'#organizacao':'#eventos'} onClick={()=>goView(organizer?'organizacao':'eventos')}>{organizer?'Criar um evento':'Explorar eventos'} <span aria-hidden="true">↗</span></a>
            </div>
            <div className="eh-spotlight" aria-label="Evento em destaque">
              <div className="eh-spotlight-art"><span className="eh-orbit orbit-a"></span><span className="eh-orbit orbit-b"></span><span className="eh-spark">✳</span></div>
              <span className="eh-spotlight-label">✦ EM DESTAQUE</span>
              <strong>{events.length?events[0].title:'Seu próximo evento merece destaque.'}</strong>
              <span className="eh-spotlight-meta">{events.length?String(events[0].atividades||0)+' atividades publicadas':'A vitrine das experiências começa aqui.'}</span>
              <a href="#eventos" onClick={()=>goView('eventos')}>Ver catálogo <span aria-hidden="true">↗</span></a>
            </div>
          </section>}
          {user&&activeView==='visao-geral'&&<div className="eh-stats">
            <div className="eh-stat"><span className="eh-stat-mark">▦</span><span className="eh-stat-label">Eventos publicados</span><strong className="eh-stat-number">{events.length}</strong><span className="eh-stat-hint">Visíveis no catálogo</span></div>
            <div className="eh-stat"><span className="eh-stat-mark">◫</span><span className="eh-stat-label">Atividades publicadas</span><strong className="eh-stat-number">{events.reduce((total,ev)=>total+Number(ev.atividades||0),0)}</strong><span className="eh-stat-hint">Total anunciado pelos eventos</span></div>
            {participant&&<div className="eh-stat"><span className="eh-stat-mark">♧</span><span className="eh-stat-label">Minhas inscrições recentes</span><strong className="eh-stat-number">{myTickets.length}</strong><span className="eh-stat-hint">Até 50 carregadas</span></div>}
          </div>}
          {message&&<p className="eh-notice" role="status" style={{...box,background:'#eaf1f6'}}>{message}</p>}
      {!user&&<section className="eh-panel" style={{...box,maxWidth:460,margin:'0 auto'}}>
        <ScreenHeading eyebrow="ACESSO EVENTHUB"
          title={mode==='verify'?'Confirme seu acesso':mode==='login'?'Entre no seu espaço':'Sua jornada começa aqui'}
          description={mode==='verify'?'Confirme o codigo temporario para continuar. No ambiente local voce pode preencher o codigo de teste automaticamente.':mode==='login'?'Continue de onde parou, com eventos e inscrições vinculados à sua conta.':'Crie sua conta para participar das próximas experiências.'}/>
        <form className="eh-editor-form" onSubmit={login}>
          {mode==='verify'?<>
            <label>Codigo de verificacao (6 digitos)
              <input style={input} inputMode="numeric" autoComplete="one-time-code"
                pattern="[0-9]{6}" maxLength={6} value={otpCode}
                onChange={e=>setOtpCode(e.target.value.replace(/[^0-9]/g,'').slice(0,6))} required/>
            </label>
            <label style={{display:'flex',alignItems:'center',gap:10}}>
              <input type="checkbox" checked={trustDevice}
                onChange={e=>setTrustDevice(e.target.checked)}/>
              Confiar neste aparelho por 30 dias
            </label>
            <button style={button} type="submit">Confirmar OTP</button>
            {simulationCode && <button style={{...button,background:'#5e7080'}}
              type="button" onClick={()=>setOtpCode(simulationCode)}>
              Preencher codigo de teste
            </button>}
            <button style={{...button,background:'#5e7080'}} type="button"
              onClick={()=>{setOtpChallenge('');setOtpCode('');setSimulationCode('');setMode('login');setMessage('');}}>Cancelar</button>
          </>:<>
            <label>E-mail<input style={input} type="email" autoComplete="username"
              value={email} onChange={e=>setEmail(e.target.value)} required/></label>
            <label>Senha (minimo 12 caracteres)<input style={input} type="password"
              autoComplete={mode==='register'?'new-password':'current-password'}
              value={password} onChange={e=>setPassword(e.target.value)}
              required minLength={mode==='register'?12:1}/></label>
            <button style={button} type="submit">{mode==='login'?'Entrar':'Cadastrar'}</button>
            <button style={{...button,background:'#5e7080'}} type="button"
              onClick={()=>setMode(mode==='login'?'register':'login')}>
              {mode==='login'?'Criar conta':'Voltar ao login'}
            </button>
          </>}
        </form>
      </section>}
      {organizer&&activeView==='organizacao'&&<OrganizerWorkspace user={user} csrf={csrf} onCatalogRefresh={refreshEvents}/>}
      {(!user||activeView==='eventos')&&<section id="eventos" className="eh-panel eh-catalog-panel" style={{...box,marginTop:18}}>
        <ScreenHeading eyebrow="CATÁLOGO EVENTHUB" title="Experiências para descobrir"
          description="Conheça os eventos publicados, escolha uma atividade e acompanhe sua participação."
          actions={<button className="eh-outline" style={button} type="button"
            onClick={()=>refreshEvents().catch(e=>setMessage(e.message))}>↻ Atualizar catálogo</button>}/>
        <div className="eh-search-field">
          <label htmlFor="eh-event-search">Buscar evento por nome</label>
          <input id="eh-event-search" type="search" value={eventQuery}
            onChange={e=>setEventQuery(e.target.value)} autoComplete="off"/>
          <span>{visibleEvents.length} de {events.length} eventos</span>
        </div>
        {!events.length&&<p className="eh-empty-state">Ainda não há eventos publicados. Volte em breve para descobrir novas experiências.</p>}
        {events.length>0&&!visibleEvents.length&&<p className="eh-empty-state">Nenhum evento encontrado com esse nome. Experimente outra busca.</p>}
        <div className="eh-event-grid">
          {visibleEvents.map(ev=><article className="eh-event-tile" key={ev.id}>
            <div className="eh-event-art" aria-hidden="true"><span className="eh-event-art-symbol">✦</span><span className="eh-event-art-line"/></div>
            <div className="eh-event-tile-body">
              <span className="eh-tile-eyebrow">EVENTO PUBLICADO</span>
              <h3>{ev.title}</h3>
              <p className="eh-tile-meta">{ev.atividades} {Number(ev.atividades)===1?'atividade':'atividades'} disponíveis</p>
              <button type="button" className="eh-tile-action" onClick={()=>loadActivities(ev.id)}>
                Ver atividades <span aria-hidden="true">↗</span>
              </button>
              {(activities[ev.id]||[]).map(a=><div className="eh-activity-card" key={a.atividade_id}>
                <strong>{a.titulo}</strong>
                <p>{a.capacidade} vagas • {a.gratuita?'Gratuita':('R$ '+(a.preco_centavos/100).toFixed(2))}</p>
                {participant&&<button type="button" onClick={()=>{setSelected(a.atividade_id);goView('inscricao');}}>Selecionar atividade</button>}
                {!participant&&<span className="eh-signin-note">Entre como participante para solicitar uma vaga.</span>}
              </div>)}
            </div>
          </article>)}
        </div>
      </section>}
      {participant&&activeView==='inscricao'&&<section id="inscricao" className="eh-panel" style={{...box,marginTop:18}}>
        <ScreenHeading eyebrow="SEU ESPAÇO" title="Inscrições em um só lugar"
          description="Solicite sua vaga, consulte cada ticket e acompanhe o histórico vinculado à sua conta."/>
        <div className="eh-step-label"><span>01</span> SOLICITAR UMA VAGA</div>
        <form className="eh-editor-form" onSubmit={register}>
          <label htmlFor="eh-selected-activity">Atividade</label>
          <select id="eh-selected-activity" value={selected}
            onChange={e=>setSelected(e.target.value)} required>
            <option value="">Selecione uma atividade do catálogo</option>
            {availableActivities.map(a=><option key={a.atividade_id} value={a.atividade_id}>{a.titulo}</option>)}
            {selected&&!availableActivities.some(a=>a.atividade_id===selected)&&
              <option value={selected}>Atividade selecionada ({selected.slice(0,8)})</option>}
          </select>
          {!availableActivities.length&&<span className="eh-field-hint">Primeiro abra um evento no catálogo para carregar suas atividades.</span>}
          <label>CPF do participante<input style={input} value={cpf} onChange={e=>setCpf(e.target.value)} required/></label>
          <button style={button}>Solicitar vaga</button>
        </form>
        <div className="eh-subheading">
          <div className="eh-step-label"><span>02</span> ACOMPANHAR TICKETS</div>
          <h3>Minhas inscrições</h3>
          <p>Suas inscrições continuam disponíveis mesmo depois de sair e entrar novamente.</p>
        </div>
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
      {user&&activeView==='notificacoes'&&<section id="notificacoes" className="eh-panel" style={{...box,marginTop:18}}>
        <ScreenHeading eyebrow="CENTRAL DE ATUALIZAÇÕES" title="Tudo o que merece sua atenção"
          description="Consulte as mudanças de status das suas inscrições e a entrega dos eventos de notificação."/>
        <p className="eh-context-note">Nesta fase, as notificações são persistidas e entregues em modo simulado, sem envio real de e-mail.</p>
        <button style={button} onClick={loadNotifications}>Atualizar notificações</button>
        {!notificationsLoaded&&<p className="eh-empty-state">Clique em “Atualizar notificações” para consultar suas atualizações.</p>}
        {notificationsLoaded&&!notifications.length&&<p className="eh-empty-state">Nenhuma atualização encontrada para sua conta.</p>}
        <div className="eh-notification-list">
          {notifications.map(n=><article key={n.event_id} className="eh-notification-card">
            <span className="eh-notification-mark" aria-hidden="true">◉</span>
            <div><strong>Inscrição {String(n.inscricao_id||'').slice(0,8)}</strong>
              <p>Entrega: {n.entrega||'Pendente'}</p>
            </div>
            <span className="eh-notification-status">{n.estado_inscricao||'Atualização'}</span>
          </article>)}
        </div>
      </section>}
          <p className="eh-footer" style={{color:'#718593',fontSize:13,marginTop:24}}>Ambiente de validacao: pagamentos e notificacoes ainda sao simulados, sem transacoes financeiras ou e-mails reais. Capacidade e fila contam com testes de contingencia; nenhuma operacao de producao esta habilitada.</p>
        </div>
      </div>
    </div>
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
