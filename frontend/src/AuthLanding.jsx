import React, {useState} from 'react';
import EventHubMark from './EventHubMark.jsx';
import './auth-landing.css';

/**
 * Acesso público do EventHub. Os fluxos reais de cadastro e autenticação
 * continuam no App: nenhuma rota fictícia ou permissão simulada no formulário.
 */
export default function AuthLanding({
  mode,email,password,message,events,otpCode,simulationCode,trustDevice,onEmailChange,onPasswordChange,onModeChange,onOtpChange,onTrustDeviceChange,onCancelVerify,onSubmit
}){
  const [showPassword,setShowPassword]=useState(false);
  const register=mode==='register';
  const verifying=mode==='verify';
  const count=events.length;
  const activities=events.reduce((sum,event)=>sum+Number(event.atividades||0),0);
  return <section className="eh-auth-landing" aria-label="Acesso ao EventHub">
    <div className="eh-auth-brandbar">
      <a href="#visao-geral" className="eh-auth-brand" aria-label="EventHub — início">
        <EventHubMark size={49}/>
        <span>Event<span>Hub</span></span>
      </a>
      <a className="eh-auth-catalog-link" href="#eventos">
        Explorar eventos <span aria-hidden="true">↗</span>
      </a>
    </div>
    <div className="eh-auth-layout">
      <div className="eh-auth-showcase">
        <div className="eh-auth-sheen" aria-hidden="true"/>
        <div className="eh-auth-showcase-copy">
          <span className="eh-auth-eyebrow"><span className="eh-auth-pulse" aria-hidden="true"/> PLATAFORMA DE EXPERIÊNCIAS</span>
          <h1>Seu próximo evento.<br/><span>Uma grande experiência.</span></h1>
          <p>Descubra oportunidades, participe de atividades e acompanhe suas inscrições. Para quem organiza, tudo sob controle, do primeiro convite à última vaga.</p>
        </div>
        <div className="eh-auth-illustration" aria-hidden="true">
          <div className="eh-auth-halo eh-auth-halo-one"/>
          <div className="eh-auth-halo eh-auth-halo-two"/>
          <div className="eh-auth-float eh-auth-float-top">
            <span className="eh-auth-float-icon">✦</span>
            <span><strong>Experiências que conectam</strong><small>Uma plataforma, várias possibilidades</small></span>
          </div>
          <div className="eh-auth-ticket">
            <div className="eh-auth-ticket-header"><span>EVENTHUB</span><span>ACESSO DIGITAL</span></div>
            <div className="eh-auth-ticket-symbol"><EventHubMark size={96}/></div>
            <div className="eh-auth-ticket-baseline"><span>Seu lugar começa aqui.</span><span aria-hidden="true">✳</span></div>
          </div>
          <div className="eh-auth-float eh-auth-float-bottom">
            <span className="eh-auth-float-check">✓</span>
            <span><strong>Inscrições organizadas</strong><small>Acompanhe seus tickets em um só lugar</small></span>
          </div>
        </div>
        <div className="eh-auth-showcase-footer">
          <span><span className="eh-auth-footer-marker">✦</span> Gestão de eventos simplificada</span>
          <span className="eh-auth-showcase-dot" aria-hidden="true"/>
          <span>{count} {count===1?'evento publicado':'eventos publicados'} · {activities} {activities===1?'atividade':'atividades'}</span>
        </div>
      </div>
      <div className="eh-auth-access">
        <div className="eh-auth-access-inner">
          <span className="eh-auth-form-overline">ACESSO À PLATAFORMA</span>
          <h2>{verifying?'Confirme seu acesso.':register?'Crie seu acesso.':'Bem-vindo de volta.'}</h2>
          <p className="eh-auth-description">{verifying
            ?'Digite o código temporário de seis dígitos para concluir o acesso.'
            :register
            ?'Cadastre-se como participante para descobrir experiências e reservar vagas.'
            :'Entre na sua conta e continue de onde parou.'}</p>
          {!verifying&&<div className="eh-auth-mode-selector" role="group" aria-label="Tipo de acesso">
            <button type="button" className={!register?'is-selected':''} aria-pressed={!register}
              onClick={()=>{setShowPassword(false);onModeChange('login')}}>Entrar</button>
            <button type="button" className={register?'is-selected':''} aria-pressed={register}
              onClick={()=>{setShowPassword(false);onModeChange('register')}}>Criar conta</button>
          </div>}
          {message&&<div className="eh-auth-feedback" role="status">{message}</div>}
          <form className="eh-auth-form" onSubmit={onSubmit}>
            {verifying?<React.Fragment>
              <label htmlFor="eh-auth-otp">Código de verificação (6 dígitos)</label>
              <input id="eh-auth-otp" type="text" inputMode="numeric" autoComplete="one-time-code"
                pattern="[0-9]{6}" maxLength={6} value={otpCode}
                onChange={e=>onOtpChange(e.target.value.replace(/[^0-9]/g,'').slice(0,6))} required />
              <label className="eh-auth-trust-check" htmlFor="eh-auth-trusted">
                <input id="eh-auth-trusted" type="checkbox" checked={trustDevice}
                  onChange={e=>onTrustDeviceChange(e.target.checked)} />
                Confiar neste dispositivo por 30 dias
              </label>
              <button className="eh-auth-submit" type="submit">Confirmar OTP
                <span aria-hidden="true">→</span>
              </button>
              {simulationCode&&<button className="eh-auth-secondary" type="button"
                onClick={()=>onOtpChange(simulationCode)}>Preencher código de teste</button>}
              <button className="eh-auth-secondary" type="button"
                onClick={onCancelVerify}>Cancelar e voltar ao login</button>
            </React.Fragment>:<React.Fragment>
              <label htmlFor="eh-auth-email">E-mail</label>
              <input id="eh-auth-email" type="email" autoComplete="email" inputMode="email"
                value={email} onChange={e=>onEmailChange(e.target.value)}
                required maxLength={255} placeholder="nome@exemplo.com" />
              <label htmlFor="eh-auth-password">Senha</label>
              <div className="eh-auth-password-wrap">
                <input id="eh-auth-password" type={showPassword?'text':'password'}
                  value={password} onChange={e=>onPasswordChange(e.target.value)}
                  required minLength={register?12:undefined} maxLength={128}
                  autoComplete={register?'new-password':'current-password'}
                  aria-describedby={register?'eh-auth-password-hint':undefined} />
                <button className="eh-auth-reveal" type="button"
                  aria-label={showPassword?'Ocultar senha':'Mostrar senha'}
                  aria-pressed={showPassword} onClick={()=>setShowPassword(x=>!x)}>
                  {showPassword?'Ocultar':'Mostrar'}
                </button>
              </div>
              {register&&<p id="eh-auth-password-hint" className="eh-auth-field-hint">Use pelo menos 12 caracteres. Este cadastro é para participantes.</p>}
              <button className="eh-auth-submit" type="submit">
                {register?'Criar conta de participante':'Entrar na plataforma'}
                <span aria-hidden="true">→</span>
              </button>
            </React.Fragment>}
          </form>
          {!verifying&&<p className="eh-auth-change-mode">{register?'Já tem uma conta?':'Ainda não possui uma conta?'}{' '}
            <button type="button" onClick={()=>onModeChange(register?'login':'register')}>
              {register?'Fazer login':'Criar conta gratuita'}
            </button>
          </p>}
          <div className="eh-auth-trust">
            <span aria-hidden="true">◇</span>
            <p>Seus eventos, inscrições e atualizações vinculados à sua conta.</p>
          </div>
        </div>
      </div>
    </div>
    <div className="eh-auth-bottom">
      <span>EventHub © {new Date().getFullYear()}</span>
      <span>Conectando pessoas e experiências.</span>
    </div>
  </section>;
}
