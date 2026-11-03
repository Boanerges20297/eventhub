import React, {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';

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
      setMyTickets(old=>[{...data},...old]);
      setMessage(data.mensagem);
    }catch(e){setMessage(e.message);}
  }
  async function refreshTicket(id){
    try{
      const data=await api('/inscricoes/'+id);
      setMyTickets(old=>old.map(item=>item.inscricao_id===id?{...item,...data}:item));
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
  return <main style={{fontFamily:'system-ui, sans-serif',background:'#f3f6f8',minHeight:'100vh',color:'#203749',padding:28}}>
    <div style={{maxWidth:920,margin:'0 auto'}}>
      <header style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap',marginBottom:24}}>
        <div><h1 style={{margin:0}}>EventHub</h1><p style={{margin:'6px 0',color:'#577086'}}>MVP academico • demonstracao local</p></div>
        {user&&<button style={button} onClick={logout}>Sair</button>}
      </header>
      {message&&<p role="status" style={{...box,background:'#eaf1f6'}}>{message}</p>}
      {!user&&<section style={{...box,maxWidth:460,margin:'0 auto'}}>
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
      {user&&<p>Perfil: <strong>{user.role}</strong> {user.org_id?'• Organizacao: '+user.org_id:''}</p>}
      {organizer&&<section style={box}>
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
      <section style={{...box,marginTop:18}}>
        <h2>Eventos publicados</h2>
        <button style={button} onClick={()=>refreshEvents().catch(e=>setMessage(e.message))}>Atualizar lista</button>
        {!events.length&&<p>Nenhum evento com atividade publicada.</p>}
        {events.map(ev=><div key={ev.id} style={{borderTop:'1px solid #ddd',marginTop:12,paddingTop:12}}>
          <strong>{ev.title}</strong> • {ev.atividades} atividades
          <p><button style={button} onClick={()=>loadActivities(ev.id)}>Ver atividades</button></p>
          {(activities[ev.id]||[]).map(a=><p key={a.atividade_id} style={{padding:8,background:'#f0f5f8'}}>
            {a.titulo} • {a.capacidade} vagas • {a.gratuita?'gratuita':'R$ '+(a.preco_centavos/100).toFixed(2)}
            {participant&&<button style={{...button,marginLeft:12}} onClick={()=>setSelected(a.atividade_id)}>Selecionar</button>}
          </p>)}
        </div>)}
      </section>
      {participant&&<section style={{...box,marginTop:18}}>
        <h2>Inscricao</h2>
        <form onSubmit={register}>
          <label>Atividade selecionada<input style={input} value={selected} onChange={e=>setSelected(e.target.value)} required/></label>
          <label>CPF do participante<input style={input} value={cpf} onChange={e=>setCpf(e.target.value)} required/></label>
          <button style={button}>Solicitar vaga</button>
        </form>
        <h3>Meus tickets nesta sessao</h3>
        {myTickets.map(t=><p key={t.inscricao_id}>
          <strong>Ticket {t.numero_ticket}</strong> — {t.estado}
          <button style={{...button,marginLeft:8}} onClick={()=>refreshTicket(t.inscricao_id)}>Consultar</button>
          {t.estado==='RESERVADO'&&<span style={{display:'inline-flex',gap:6,flexWrap:'wrap',marginTop:8}}>
            <button style={button} onClick={()=>simulatePayment(t.inscricao_id,'PAGO')}>Simular aprovado</button>
            <button style={button} onClick={()=>simulatePayment(t.inscricao_id,'RECUSADO_DEFINITIVO')}>Simular recusa</button>
            <button style={button} onClick={()=>simulatePayment(t.inscricao_id,'INDETERMINADO')}>Simular incerteza</button>
          </span>}
        </p>)}
      </section>}
      <p style={{color:'#718593',fontSize:13,marginTop:24}}>Interface de teste funcional. Pagamentos sao simulados, sem cobranca real. Notificacoes e contingencia permanecem em desenvolvimento.</p>
    </div>
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
