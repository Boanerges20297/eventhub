# EventHub — cinco ADRs formais para o relatorio
**Data:** 02/11/2026. **Estado:** consolidacao documental de decisoes arquiteturais JA APROVADAS (DA-00..DA-14). Os contratos e testes ainda nao foram validados; este arquivo nao autoriza implementar. ADR nao e a mesma numeracao do registro DA.

## ADR-001 — Decompor por capacidade de negocio e implementar cinco microsservicos
**Status:** decisao aprovada; implementacao pendente. **Origem:** DA-00, DA-06, DA-09.
**Contexto/forcas:** EventHub tem RFs diversos (identidade, eventos, inscricoes, pagamentos, notificacoes, check-in, certificados, relatorios), carga concentrada em consultas/inscricoes e exigencia academica de pelo menos duas stacks de backend.
**Alternativas:** (A) monolito: baixa complexidade inicial, mas nao demonstra microsservicos; (B) microsservico por RF: fragmentacao excessiva; (C) **oito candidatos, executar cinco**.
**Decisao:** Identidade, Eventos e Pagamentos em Node.js/Fastify; Inscricoes e Notificacoes em Python/FastAPI. Modelar Check-in, Certificados e Relatorios sem executa-los. Frontend React/Vite separado.
**Consequencias:** demonstrar autonomia, limites de dominio e interoperabilidade, pagando com latencia e coordenacao distribuidas; manter prototipo na faixa solicitada (5 servicos) e nao criar tecnologias sem necessidade.
**Evidencia a produzir:** diagrama de contexto e containers, APIs por servico, logs de fluxo Eventos -> Inscricoes -> Pagamentos e participacao Node + Python; nao ha evidencias executadas nesta fase.

## ADR-002 — FIFO duravel, um dono da ocupacao e contingencia SQLite
**Status:** decisao aprovada; implementacao pendente. **Origem:** DA-01, DA-02, DA-06, DA-07, DA-10, DA-11, DA-14.
**Contexto/forcas:** pico de acesso, reservas temporarias, capacidade por atividade e necessidade de aceitar pedidos quando MySQL ficar indisponivel, sem ultrapassar vagas ou furar fila.
**Alternativas:** (A) confiar em timestamps do navegador: nao garante ordem nem integridade; (B) compartilhar tabelas entre microsservicos: acoplamento; (C) **ticket sequencial no servidor + Inscricoes dono da ocupacao**.
**Decisao:** sequencia FIFO por atividade emitida por um processo autoritativo SQLite persistente; uma intencao gera um ticket. Inscricoes controla reservas/ocupacao e aplica vagas em transacoes/locks InnoDB, com bancos/usuarios isolados por servico em MySQL unico. Eventos configura capacidade; mudancas coordenadas por operation_id e versao, sem reduzir abaixo das vagas comprometidas. SQLite aceita pedidos no modo degradado, **nao concede vagas** e concilia depois com idempotencia. CPF + atividade impede inscricao ativa duplicada; cancelamento/expiracao definitivos permitem novo ticket no fim da fila.
**Consequencias:** implementacao de fila e reconciliacao aumenta complexidade, mas oferece caso concreto para demonstrar consistencia e tolerancia a falha; MySQL unico e VPS unica sao SPOFs explicitamente aceitos. Falha de SQLite tambem impede aceitar novos tickets.
**Evidencia a produzir:** 200 pedidos/30 vagas; ordem FIFO; queda e retomada do MySQL; crash depois de commit e antes de marcar SQLite; tentativa duplicada por CPF; teste de reducao concorrente de capacidade.

## ADR-003 — REST sincrono seletivo + worker FIFO + outbox, sem broker externo
**Status:** decisao aprovada; implementacao pendente. **Origem:** DA-05, DA-08, DA-11, DA-14.
**Contexto/forcas:** consulta exige resposta; notificacao e processamento de inscricao podem ser assincronos; falhas de email nao podem desfazer negocio; reentregas sao inevitaveis.
**Alternativas:** (A) todas as chamadas sincronas: propagacao de falhas; (B) RabbitMQ e malha de eventos: operacionalmente desproporcional para prototipo; (C) **REST nas consultas, worker persistente no processamento e Outbox + dispatcher na notificacao**.
**Decisao:** API registra pedido duravel e devolve HTTP 202 com ticket, sem garantir vaga; worker o processa FIFO. Integracoes imediatas via REST interno. Servico emissor grava resultado e evento de Outbox em sua propria transacao; dispatcher reenvia e Notificacoes deduplica event_id. Idempotency-Key protege reenvio HTTP, chaves/ids persistidos protegem reprocessamento.
**Consequencias:** consistencia eventual da notificacao e estados PENDENTE exigem rastreio/correlacao; sem RabbitMQ, menor custo de configuracao, mas nao ha entrega magica exactly-once. Protecao real e efeito idempotente.
**Evidencia a produzir:** inscricao confirmada com Notificacoes desligado; reenvio posterior sem duplicar efeito; callback repetido; logs correlacionados com ticket.

## ADR-004 — Caddy na borda e gateway Fastify com JWT/RBAC
**Status:** decisao aprovada; implementacao pendente. **Origem:** DA-02, DA-12, DA-13.
**Contexto/forcas:** uma VPS, cinco servicos de negocio em containers distintos e necessidade de HTTPS com superficie publica reduzida, sem PHP.
**Alternativas:** (A) publicar portas de cada backend: superficie de ataque maior; (B) Nginx: valido, mas nesta configuracao requer mais trabalho para certificados; (C) **Caddy HTTPS automatico + gateway Node/Fastify**.
**Decisao:** Caddy como unico container com portas publicadas, servindo React estatico e repassando /api para gateway interno Node/Fastify. Identidade emite JWT; gateway implementa middleware central de verificacao de assinatura, papel (RBAC) e tabela fixa de rotas. Servicos fazem checagem de propriedade da organizacao/recurso. Cookies HttpOnly/Secure/SameSite com defesa CSRF; segredos nao versionados. Nenhum PHP.
**Consequencias:** configuracao HTTPS mais curta e uma borda clara; gateway e ponto de falha extra, mas evita repeticao de verificacao de rota. JWT precisa expiracao/renovacao adequada; a rede interna NAO e justificativa para confiar cegamente em chamadas internas. Caddy nao e sistema de autorizacao.
**Evidencia a produzir:** acesso sem token -> 401; role errada -> 403; organizador de outro tenant -> 403; somente Caddy exposto no Compose, teste de HTTPS e ausencias de segredos em repositorio.

## ADR-005 — Maquina de estados do pagamento segue RN03 com verificacao de estados incertos
**Status:** **revisao aprovada em 02/11/2026**, substitui a antiga regra de 10 minutos na primeira recusa (DA-03). **Origem:** DA-03, DA-04, DA-14.
**Contexto/forcas:** reservas sao escassas, callbacks podem atrasar e a RN03 do enunciado manda liberar vaga na recusa/expiracao. Precisa evitar tanto reserva eternizada quanto liberacao antes de apurar um pagamento real.
**Alternativas:** (A) liberar vaga em qualquer timeout: risco de overbooking de pagamento tardio; (B) janela extra de 10 minutos apos a primeira recusa: rejeitada por contrariar RN03 e ampliar estados; (C) **liberacao em recusa definitiva, protecao temporaria apenas no estado incerto**.
**Decisao:** reserva com prazo configuravel por atividade e padrao de 30 minutos a partir da concessao (RN02 aprovada; detalhes do campo a validar); primeira recusa definitiva ou expiracao definitiva libera vaga ao proximo ticket. Pagamento efetivamente ocorrido dentro do prazo pode ser confirmado mesmo se callback chegar tarde; enquanto status for incerto, nao tratar como recusa e manter EM_VERIFICACAO, com verificacoes de 15 minutos e escalonamento ao admin, conforme DA-04. Eventual PIX manual de 30 minutos exige recebimento verificado e auditoria, sem gerar vaga dupla. Novo pedido apos encerramento recebe novo ticket no fim da fila.
**Consequencias:** atinge RN03 e reduz complexidade por remover segunda tentativa na mesma reserva; mantem estado de excecao para timeout realmente incerto, com possivel bloqueio prolongado ate conciliacao. O simulador deve distinguir RECUSADO_DEFINITIVO de INDETERMINADO.
**Evidencia a produzir:** primeira recusa libera; timeout nao libera; comprovacao de pagamento no prazo com callback atrasado nao prejudica participante; callback repetido nao gera segunda cobranca ou reserva.

---

## Regras da defesa e limites
- **Atualizacao DA-15 (02/11/2026):** cancelamento valido de inscricao paga confirmada libera vaga de forma idempotente; eventual reembolso e analise administrativa auditada no proprio servico Pagamentos, sem estorno automatico. Enquanto resultado financeiro incerto, nao liberar vaga ate conciliar. Incorporar este complemento ao ADR-005 no relatorio final, sem criar sexto ADR.
- **Atualizacao DA-16/17/18 (02/11/2026):** lista de espera habilitada por padrao e configuravel por atividade (incorporar ao ADR-002); sincronizacao inicial e alteracoes de capacidade duraveis, versionadas e idempotentes (ADR-002); JWT com claims minimas, cookie 30 min sem refresh, CSRF/Origin e RBAC/ownership (ADR-004). Evidencias ainda a produzir.
- Estes sao **cinco ADRs**, consolidados do registro DA-00..DA-18, nao dezenove ADRs independentes.
- Diagramas, contrato de API e provas devem refletir os mesmos nomes/estados. Nao relatar teste planejado como teste executado.
- Pergunta central do trabalho: **o que ganhamos e o que pagamos pela distribuicao?** Ganhos: separacao de dominios, independencia e isolamento. Custos: comunicacao, consistencia eventual, testes de integracao, conciliacao e operacao de containers.
- Sem Kubernetes, RabbitMQ, Redis, service mesh nem plataforma de observabilidade pesada: nao elevam comprovadamente a nota do recorte atual.
