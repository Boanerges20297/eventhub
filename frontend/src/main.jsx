import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  const [status, setStatus] = useState('verificando');
  useEffect(() => {
    let active = true;
    fetch('/api/health')
      .then((response) => {
        if (!response.ok) throw new Error('sem resposta');
        return response.json();
      })
      .then((data) => {
        if (active) setStatus(data.status === 'up' ? 'online' : 'indisponivel');
      })
      .catch(() => { if (active) setStatus('indisponivel'); });
    return () => { active = false; };
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '80px auto', padding: 24 }}>
      <h1>EventHub</h1>
      <p>Ambiente local de desenvolvimento — tela tecnica provisoria.</p>
      <p>Gateway: <strong>{status}</strong></p>
      <p>Fluxos de inscricao, pagamento e autenticacao permanecem em construcao.</p>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
