# Fluxos e estados — EventHub

**Natureza:** modelagem de planejamento. Nao ha implementacao ou teste comprovado nesta etapa.

## 1. Pedido de inscricao — UX padrao
1. Participante escolhe atividade e solicita inscricao.
2. API de Inscricoes valida os dados minimos e registra atomicamente o pedido com um ticket sequencial por atividade no emissor unico persistente SQLite.
3. Somente apos persistir, responde com inscricao_id, ticket, estado REGISTRADO (proposta de enum; pedido pendente de processamento) e a mensagem padrao de processamento futuro.
4. Worker recebe tickets em ordem por atividade e coordena concessao de reserva no MySQL/InnoDB.
5. Para atividade gratuita: confirma mediante regras da atividade e ocupacao valida.
6. Para atividade paga: cria reserva com prazo **configuravel por atividade**, padrao de **30 minutos contados da concessao** (RN02 aprovada), registra vencimento e inicia pagamento simulado.
7. Eventos de resultado entram em Outbox para notificacao assincrona e acompanhamento por ticket.

## 2. Maquinas de estados — PROPOSTA TECNICA para aprovacao (02/11/2026)

**Separacao obrigatoria:** Inscricoes decide se a vaga esta comprometida; Pagamentos decide o resultado financeiro; Notificacoes decide apenas entrega. Nao duplicar estados financeiros ou de email como se fossem estados de inscricao. Os NOMES exatos e transicoes abaixo ainda nao estao aprovados; respeitam as regras de negocio ja aprovadas.

### 2.1 Inscricoes — estado do pedido e efeito sobre vagas

| Estado | Significado | Ocupa vaga? | Estado final? |
|---|---|---|---|
| REGISTRADO | Pedido + ticket persistidos no SQLite; sem vaga prometida | Nao | Nao |
| EM_FILA | Espera FIFO; inclui fallback sem MySQL | Nao | Nao |
| RESERVADO | Vaga concedida a atividade paga; prazo por atividade (padrao 30 min a partir da concessao) | Sim | Nao |
| EM_VERIFICACAO | Pagamento incerto ou comprovacao de pagamento em prazo aguardando conciliacao; vaga protegida | Sim | Nao |
| CONFIRMADO | Gratuita confirmada, ou paga comprovadamente dentro do prazo | Sim | Nao: pode ocorrer cancelamento |
| RECUSADO | Primeira recusa financeira DEFINITIVA; reserva encerrada pela RN03 | Nao | Sim |
| EXPIRADO | Prazo encerrado e AUSENCIA de pagamento valida apurada definitivamente | Nao | Sim |
| CANCELADO | Pedido/inscricao cancelado com liberacao segura da vaga | Nao | Sim |
| SEM_VAGA | Pedido nao atendido quando espera estiver desabilitada/encerrada | Nao | Sim |

**Fila com espera habilitada:** sem vaga disponivel -> EM_FILA; quando surgir vaga, worker atende menor ticket elegivel. **Espera desabilitada:** pode encerrar como SEM_VAGA. Exigir registro de decisao e versao de capacidade para auditoria.

**Fechamento tecnico APROVADO (DA-16 e DA-17):** `lista_espera_habilitada=true` por padrao em cada atividade, com opcao de desabilitar antes da abertura. Ao encerrar inscricoes (no maximo no inicio da atividade), pedidos ainda em EM_FILA que nao conseguiram vaga tornam-se SEM_VAGA, sem reservar e com notificacao assincrona. Nova atividade nao abre inscricoes ate versao inicial de capacidade ser aplicada em Inscricoes. Alteracao de capacidade permanece PENDENTE em Eventos ate ACK idempotente do limite operacional; uma operacao por atividade a cada vez. Ver P1/P2 em pendencias-e-validacao.md.

### 2.2 Transicoes de Inscricoes e guardas (propostas)

| De | Gatilho e guarda | Para | Efeito atomico |
|---|---|---|---|
| novo | Persistir CPF normalizado + atividade + Idempotency-Key no SQLite e emitir ticket unico | REGISTRADO | Responder 202/ticket, sem vaga |
| REGISTRADO / EM_FILA | MySQL indisponivel OU sem vaga, espera habilitada | EM_FILA | Nao reservar; preservar ticket |
| REGISTRADO / EM_FILA | Chegou a vez, ha vaga, gratuita | CONFIRMADO | Ocupacao +1 sob lock e transacao MySQL |
| REGISTRADO / EM_FILA | Chegou a vez, ha vaga, paga | RESERVADO | Ocupacao +1, inicio e vencimento gravados |
| REGISTRADO / EM_FILA | Sem vaga e espera fechada | SEM_VAGA | Encerrar sem consumir vaga |
| RESERVADO | Pagamento tempestivo verificado | CONFIRMADO | Mantem a mesma vaga; nao soma outra |
| RESERVADO | Primeira recusa definitiva | RECUSADO | Ocupacao -1 e sinal para proximo ticket |
| RESERVADO | Expiracao definitivamente nao paga | EXPIRADO | Ocupacao -1 e sinal para proximo ticket |
| RESERVADO | Pagamento incerto ao vencer ou callback tardio de pagamento realizado no prazo | EM_VERIFICACAO | Nao liberar vaga |
| EM_VERIFICACAO | Comprovado pagamento valido no prazo ou PIX manual verificado | CONFIRMADO | Mantem a vaga; idempotente |
| EM_VERIFICACAO | Apurada recusa/ausencia de pagamento definitivas | RECUSADO / EXPIRADO | Liberar UMA vez; proximo ticket |
| REGISTRADO / EM_FILA / RESERVADO / CONFIRMADO | Cancelamento autorizado e financeiro resolvido, se aplicavel | CANCELADO | Liberar vaga somente se estava ocupada; auditar |
| EM_VERIFICACAO | Usuario solicita cancelar | EM_VERIFICACAO | Registrar intencao de cancelar; NAO liberar ate conciliar cobranca |

**Guarda geral:** nao aceitar evento retroativo/duplicado que reconceda vaga liberada, nem duas transicoes terminais divergentes. Se provedor emitir resposta contraditoria depois de recusa definitiva e liberacao, abrir incidente de conciliacao/reembolso administrativo; NUNCA confirmar automaticamente sobre uma vaga ja transferida.

### 2.3 Pagamentos — estado de uma tentativa financeira (proposta)

| Estado | Entrada | Saida / efeito |
|---|---|---|
| PENDENTE | Inscricoes pede simulacao para RESERVADO | Aguarda resultado |
| PAGO | Provedor confirma pagamento validamente realizado no prazo | Comunicar resultado idempotente a Inscricoes |
| RECUSADO_DEFINITIVO | Provedor nega de forma conclusiva | RN03: Inscricoes libera reserva |
| INDETERMINADO | Timeout/retorno inconclusivo | Consultar novamente; Inscricoes protege vaga |
| EXPIRADO_DEFINITIVO | Prazo vencido e verificada ausencia de pagamento | Inscricoes libera reserva |

- **PIX manual (DA-04):** oferta administrativa apos 15 min de verificacoes, janela de 30 min e comprovacao efetiva de credito. E um **processo de contingencia associado** a tentativa/inscricao, nao uma segunda vaga ou uma segunda tentativa automatica sobre reserva ja recusada.
- Evento de callback carrega event_id + tentativa_id + ocorrido_em + recebido_em; deduplicar event_id e validar transicao/ordem por tentativa. Timestamp sozinho nao faz prova de pagamento.
- Nao enviar 'RECUSADO_DEFINITIVO' baseado em timeout. Repetir consulta sem criar outra cobranca.

### 2.4 Notificacoes — estado independente

- PENDENTE -> ENVIADA ou FALHA_TEMPORARIA -> PENDENTE (reprocessamento); dedupe por event_id.
- Falha na entrega NAO reverte CONFIRMADO, RECUSADO ou EXPIRADO em Inscricoes.
- Outbox pertence ao banco do emissor; identificar cada mensagem duravelmente antes de acionar o worker.

### 2.5 Invariantes de consistencia e pontos em aberto

- **Capacidade:** comprometidas = RESERVADO + EM_VERIFICACAO + CONFIRMADO; nunca exceder capacidade operacional. Pedidos REGISTRADO/EM_FILA nao ocupam vaga.
- **CPF + atividade (APROVADO):** no maximo uma inscricao ativa; historico de CANCELADO, EXPIRADO e RECUSADO preservado. Apos qualquer um desses encerramentos **definitivos**, uma nova solicitacao e permitida com nova intencao e novo ticket no fim da fila, sem vaga garantida ou prioridade restaurada. Pagamento incerto continua protegido e impede reinscricao concorrente.
- **Idempotencia:** mesmo Idempotency-Key e payload -> mesmo ticket; chave diferente com mesmo CPF + atividade ativa -> conflito, sem novo ticket; callback duplicado nao altera estado duas vezes.
- **Cancelamento de inscricao paga confirmada (DA-15 APROVADA):** cancelamento valido e definitivo libera vaga UMA vez, desperta o proximo ticket FIFO e preserva o pagamento historico. Reembolso e **solicitacao administrativa separada**, sujeita a politica aplicavel e comprovacao, sem estorno automatico.
- **Fluxo pago confirmado, proposto:** CONFIRMADO -> CANCELADO com transacao de liberacao -> Pagamentos registra pedido de reembolso PENDENTE_ANALISE -> analise do administrador -> decisao/evidencia registrada. A situacao financeira nao altera retroativamente a ocupacao liberada.
- **Fluxo incerto, ja aprovado:** EM_VERIFICACAO + pedido de cancelamento -> registrar intencao e continuar verificacao; so liberar vaga apos esclarecer o pagamento e efetivar cancelamento seguro. Nao assumir que timeout e recusa.
- **Estados do reembolso (NOMES PROPOSTOS):** PENDENTE_ANALISE, APROVADO, NEGADO, CONCLUIDO_COM_EVIDENCIA; sem afirmar devolucao executada apenas por aprovar. Sem prometer reembolso automaticamente a todos os cancelamentos.
- **SEM_VAGA x EM_FILA:** depende da regra de lista de espera habilitada, ainda a concretizar por atividade.
- Todos os nomes de enums, transicoes especiais e retencao de chaves sao PROPOSTA para revisao; NAO houve codigo nem teste.

### Reinscricao depois de encerramento (regra aprovada)
- Para a mesma atividade, CPF com inscricao ativa nao gera nova inscricao nem novo ticket.
- Depois de CANCELADO, EXPIRADO ou RECUSADO em carater definitivo, pode fazer **nova inscricao**: nova chave da intencao, **novo ticket sequencial no fim da fila**. Nao herda prioridade nem possui garantia de vaga.
- Preservar o registro historico anterior. A transicao de encerramento e a nova emissao devem observar unicidade somente de inscricoes ativas.
- EM_VERIFICACAO, pagamento no prazo aguardando conciliacao ou tentativa ainda valida **nao sao expiracao definitiva**. Nesses casos, proteger a vaga e nao permitir reinscricao concorrente.

## 3. Falha do MySQL e conciliacao
1. Healthcheck detecta falha; o serviço de Inscricoes deixa de tentar conceder vagas pelo MySQL.
2. API continua aceitando solicitacoes apenas se o SQLite persistente estiver disponivel.
3. Emissor unico de tickets continua em ordem; pedido armazenado com status aguardando conciliacao.
4. Interface entrega a mesma mensagem padrao do modo normal, sem mentir sobre reserva confirmada.
5. Com MySQL recuperado, coordenador de conciliacao impede que novos pedidos ultrapassem tickets antigos da mesma atividade.
6. Reprocessa tickets em ordem, em transacoes idempotentes, observando capacidade e reservas existentes.
7. So apos commit verificavel no MySQL marca pedido conciliado no SQLite; limpeza posterior reprocessavel.
8. Outbox / notificacoes comunica resultado, inclusive falta de vagas.

## 4. Falha de pagamento
- Na PRIMEIRA recusa comprovada e definitiva, encerrar a reserva e liberar a vaga imediatamente ao proximo ticket (RN03); nao ha janela extra de 10 min nem segunda tentativa na mesma reserva.
- Expiracao definitiva sem pagamento valido tambem libera vaga; pedido novo depois desse encerramento recebe novo ticket ao final da fila.
- Confirmacao tardia com comprovacao de pagamento dentro do prazo: preservar direito do participante; nao conceder mesma vaga a duas pessoas.
- Se status continuar indeterminado no encerramento do prazo, manter vaga protegida e verificar intensivamente durante 15 min; persistindo a duvida, alertar admin e seguir conciliacao controlada.
- Admin pode contatar cliente e oferecer PIX direto com 30 min; nao aprovar somente com comprovante nao verificado.
- Eventual cobranca duplicada gera ocorrencia e trilha de estorno, nao duas inscricoes.

## 5. Diagrama conceitual — sequencia de inscricao (Mermaid)
~~~mermaid
sequenceDiagram
    actor P as Participante
    participant F as Frontend React
    participant I as Inscricoes / FastAPI (candidato)
    participant S as SQLite tickets
    participant M as MySQL InnoDB
    participant G as Pagamentos / Fastify (candidato)
    participant N as Notificacoes
    P->>F: Solicitar vaga
    F->>I: POST /inscricoes
    I->>S: Gerar ticket e persistir pedido
    S-->>I: Ticket + durabilidade
    I-->>F: 202 / inscricao_id / ticket / REGISTRADO
    F-->>P: Solicitação registrada (sem prometer vaga)
    Note over I,M: Worker atende tickets em ordem por atividade
    I->>M: Transacao atomica de reserva
    alt Vaga concedida e atividade paga
      I->>G: Iniciar pagamento
      G-->>I: Status / referencia
      G-->>I: Resultado eventual (idempotente)
      I->>M: Confirmar ou liberar segundo regras
    else MySQL indisponivel
      Note over I,S: Permanecer pendente e conciliar quando retornar
    end
    I-->>N: Evento duravel via outbox/dispatcher
    N-->>P: Email de resultado
~~~

## 6. Diagrama conceitual — componentes (Mermaid)
~~~mermaid
flowchart TB
    Browser["Navegador do participante"] --> Edge["Caddy - container de borda unico HTTPS - frontend React/Vite + proxy REST"]
    subgraph VPS["VPS unica / Docker Compose"]
      Edge --> Gateway["Gateway / middleware RBAC - Node/Fastify"]
      Gateway --> ID["Identidade - Node/Fastify"]
      Gateway --> EV["Eventos - Node/Fastify"]
      Gateway --> IN["Inscricoes - Python/FastAPI"]
      subgraph Internal["Rede interna Docker - nenhum backend ou banco com porta publicada"]
        ID
        EV
        IN
        PAY["Pagamentos - Node/Fastify"]
        NO["Notificacoes - Python/FastAPI"]
        DB[("MySQL InnoDB - 1 instancia, bancos e usuarios separados")]
        SQ[("SQLite persistente - ticket e fila offline")]
        WD["Watchdog / healthchecks"]
      end
      IN -->|REST interno| PAY
      IN -->|Outbox / worker| NO
      IN --> SQ
      ID --> DB
      EV --> DB
      IN --> DB
      PAY --> DB
      NO --> DB
      WD -.-> ID
      WD -.-> EV
      WD -.-> IN
      WD -.-> PAY
      WD -.-> NO
    end
~~~

**Regras fechadas de implantacao:** cada um dos cinco backends em seu proprio container; MySQL em container isolado com volume; somente a entrada HTTP(S) do frontend/proxy e publica. O navegador nao chama nomes/portas internas Docker diretamente. Cada servico usa apenas o seu proprio banco logico e credenciais. Check-in, Certificados e Relatorios serao **modelados**, nao implantados nesta etapa.

**DA-11 aprovada:** alteracoes de capacidade usam identificador unico de operacao e versao por atividade; reenvios idempotentes e conciliacao apos falha. Enquanto Eventos e Inscricoes nao concluirem a sincronizacao, operacao permanece PENDENTE. Inscricoes aplica capacidade sob transacao sem reduzir abaixo da ocupacao comprometida, respeitando o worker FIFO. **DA-17 APROVADA:** operacao duravel em Eventos, versao inicial 1, uma alteracao pendente por atividade, ACK idempotente, bloqueio da publicacao ate sincronizacao e recuperacao apos falha. Permanecem pendentes apenas DTOs finais e politica de intervalos de retry. Caddy como proxy reverso e borda HTTPS foi APROVADO (DA-12): container separado, frontend estatico e rotas internas, sem publicacao direta das APIs ou bancos. Continuam em aberto detalhes de dominio/DNS, roteamento, limites de acesso e verificacao de autorizacao nos backends. Nenhuma implementacao iniciada.
