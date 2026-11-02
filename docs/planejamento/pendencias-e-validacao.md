# Pendencias, riscos e estrategia de validacao — EventHub

**Status:** as entradas nesta secao NAO estao aprovadas, salvo se declaradas como regra ja aceita. Nao iniciar implementacao.

## Pontos em aberto a discutir
1. **DEFINIDO (DA-09):** 8 microsservicos projetados; 5 implementados (Identidade, Eventos, Inscricoes, Pagamentos, Notificacoes) em containers separados na mesma VPS; 3 modelados (Check-in, Certificados, Relatorios).
2. **DEFINIDO (DA-09):** Node/Fastify para Identidade, Eventos e Pagamentos; Python/FastAPI para Inscricoes e Notificacoes. Frontend React/Vite.
3. **APROVADO (DA-12):** Caddy em container proprio como unica borda HTTP(S), servindo frontend React/Vite e fazendo proxy por rede interna Docker; sem porta publica de backends, MySQL, SQLite ou workers. HTTPS automatico e menor configuracao sao justificativas documentadas; Caddy nao depende de PHP. **AINDA ABERTO:** dominio/DNS, limites de taxa, detalhes de roteamento, autorizacao nas APIs e testes da renovacao de certificados.
4. **REGRA APROVADA (DA-10):** Eventos pode solicitar reducao de capacidade, mas Inscricoes so aplica limite operacional >= reservas ativas + confirmadas; pedidos que apenas aguardam processamento nao ocupam vaga. Validacao/aplicacao atomica e coordenada com worker FIFO. **DA-11 APROVADA:** identificador unico de operacao, versionamento, reenvio idempotente e recuperacao apos falha, com status PENDENTE ate sincronizar. **DA-17 APROVADA:** versao inicial 1, operacao duravel, capacidade aplicada em Inscricoes com FIFO, reenvios idempotentes e somente publicacao apos sincronizacao. Pendem DTOs finais e intervalo de retentativas.
5. **DA-17 APROVADA:** atividade criada NAO_PUBLICADA, operacao PENDENTE com versao 1; Inscricoes aplica limite e libera publicacao somente depois do ACK. Uma mudanca por atividade por vez, sem transacoes distribuidas.
6. **Ticket SQLite:** ownership pelo servico Inscricoes, controle de transacao SQLite de emissao de tickets, sequence por atividade, limite de throughput e recuperacao de falhas no proprio SQLite.
7. **Outbox entre servicos:** localizacao da outbox no banco do emissor, formato de eventos, destino do worker, reentrega e inbox/deduplicacao do receptor; proibicao de usar banco de outro servico.
8. **Pagamento:** maquina de estados documentada em fluxos-e-estados.md; DA-15 resolveu o cancelamento/reembolso administrativo. Pendente: formato definitivo dos contratos e tratamento de retorno contraditorio do simulador; preservar idempotencia.
9. **APROVADO (DA-13):** Identidade emite JWT; middleware/gateway Node.js/Fastify central valida autenticacao e RBAC por rota, encaminhando pelo Docker; microsservicos verificam pertencimento dos recursos/organizacao. Cookies HttpOnly/Secure/SameSite, defesa CSRF, senhas com hash e segredos fora do Git. **DA-18 APROVADA:** claims minimas, sessao de 30 min sem refresh, CSRF/Origin e papeis definidos. Pendem detalhes de assinatura/chaves, tabela final de rotas e testes.
10. **Notificacoes:** servico simulado ou SMTP real para defesa, com estrategia de retentativa e provas de entrega.
11. **Observabilidade:** correlation_id, ticket_id, timestamps de auditoria, log estruturado e como vincular evidencias.
12. **Resiliencia:** protecao de SQLite e volumes, risco de SPOF em VPS unica, watchdog autorizado somente a containers EventHub.
13. **Entrega de componentes nao implementados:** Check-in, Certificados, Relatorios — diagramas e contratos suficientes para defesa.
14. **ADRs formais:** cinco ADRs ja REDIGIDOS em adrs-formais.md (ADR-001..005), usando decisoes aprovadas. Validar referencias cruzadas e posteriormente anexar evidencias reais dos testes.

## Auditoria do enunciado original (02/11/2026)
- **RN02 — APROVADA:** prazo de reserva configuravel por atividade, padrao de 30 minutos, contados da concessao da vaga. Restam apenas detalhes do contrato do campo.
- **RN03 — RESOLVIDA por decisao de 02/11/2026:** primeira recusa COMPROVADA libera a vaga; regra antiga de 10 min foi revogada. Expiracao definitiva tambem libera; estado INDETERMINADO permanece EM_VERIFICACAO (DA-04). Fluxos e testes atualizados; ADR-005 consolidada.
- **RN04:** validar cancelamento, liberacao de vaga e proximo ticket FIFO.
- **RQ08:** execucao local reproduzivel via Docker Compose, dados de teste e instrucoes, alem da VPS.
- **Entregaveis:** contratos REST/eventos em rascunho (contratos-api.md), maquinas de estados propostas com guardas (fluxos-e-estados.md) e cinco ADRs formais redigidos (adrs-formais.md); **ainda pendem** aprovacao dos enums/transicoes e DTOs/rotas, diagrama de contexto, relatorio, codigo, testes, logs e defesa. Implementacao proibida ate aprovacao integral.
- **Recorte:** 5 microsservicos implementados e 3 modelados e permitido. O enunciado valoriza justificativa, nao quantidade de tecnologias ou padroes.

## DA-14 — Idempotencia minima [APROVADA; ver decisoes-arquiteturais.md]
**Objetivo:** repetir a mesma intencao nao cria outra inscricao, ticket, reserva ou cobranca. Sem broker ou microsservico adicional para deduplicacao.

1. **Inscricao:** React gera uma chave Idempotency-Key (UUID) no primeiro envio e reutiliza nos retries. Inscricoes associa chave a usuario e atividade. A operacao atomica no SQLite vincula chave, pedido e um unico ticket. Reenvio identico retorna o mesmo ticket e status; chave reutilizada com conteudo diferente retorna conflito.
2. **Unicidade aprovada por CPF + atividade:** solicitar CPF, validar os digitos e normalizar; impedir duplicidade dos estados pendente, em fila, reservado, em verificacao e confirmado em SQLite e MySQL, sob transacao. Mesmo CPF em atividades diferentes e permitido. CPF nao comprova titularidade: autenticacao permanece necessaria, sem expor CPF ou ticket de terceiros. **Reinscricao APROVADA:** apos cancelamento, expiracao ou recusa definitivos, novo pedido do mesmo CPF + atividade e permitido com novo ticket no final da fila FIFO e sem garantia de vaga; manter historico, nao restaurar prioridade. Pagamento em verificacao nao equivale a expiracao definitiva.
3. **Worker FIFO:** no MySQL do servico Inscricoes, registrar ticket unico e aplicar reserva transacional idempotente; retomada da conciliacao offline nao concede outra vaga.
4. **Pagamento:** retries da mesma tentativa nao geram outra cobranca; recusa comprovada libera vaga imediatamente. Nova inscricao (se desejada) recebe novo ticket e eventual nova tentativa. Callbacks duplicados usam id do evento externo e transicoes atomicas.
5. **Outbox / notificacoes:** identificadores unicos de evento e de processamento, com reentrega e deduplicacao; envio de e-mail nao bloqueia confirmacao.
6. **Seguranca:** chave de idempotencia nao substitui autenticacao ou autorizacao; proteger dados e segredos nos logs.
**Testes propostos:** POST repetido, duplo clique concorrente, queda entre commit MySQL e marcacao SQLite, callback repetido 3 vezes, primeira recusa definitiva liberando vaga e novo ticket no fim da fila. Verificar ausencia de tickets, vagas e cobrancas duplicadas.
**Ainda em aberto:** periodo de retencao das chaves e mecanismo de unicidade somente para registros ativos. **Reinscricao apos cancelamento, expiracao ou recusa definitivos esta APROVADA:** novo ticket no fim da fila sem garantia de vaga.

## Decisoes pontuais pendentes sobre a maquina de estados
- **Reentrada apos RECUSADO — APROVADA:** apos recusa definitivamente concluida, pode fazer nova inscricao na mesma atividade com nova Idempotency-Key, novo ticket ao final da fila e sem garantia de vaga; nao restaura reserva nem cobranca anterior.
- **Cancelamento pago — DA-15 APROVADA:** cancelamento seguro e definitivo libera vaga uma unica vez para o proximo ticket. Inscricao paga confirmada gera pedido de reembolso administrativo separado; sem estorno automatico no prototipo. Situacao EM_VERIFICACAO bloqueia liberacao antecipada. PENDENTE apenas politica concreta de elegibilidade e nomes de estados administrativos (nenhuma devolucao garantida sem analise).
- **Fila de espera por atividade (DA-16 APROVADA):** configuravel antes de abrir inscricoes, habilitada por padrao. Habilitada sem vagas -> EM_FILA; desabilitada -> SEM_VAGA. Fila sem atendimento encerra no fechamento das inscricoes.
- **Detalhes de simulacao de pagamento e contratos:** impedir resultado definitivo contraditorio de callback e nao reconceder vaga; tratar divergencia como incidente; manter PIX manual sob auditoria.

## Fechamento tecnico — fila, capacidade e seguranca [P1/P2/P3 APROVADAS em 02/11/2026]
**Objetivo:** permitir implementacao do recorte existente sem banco cruzado, broker, cache novo ou mecanismos extras. Respeitar DA-10/11/13 e RN04.

### P1 — Lista de espera por atividade (APROVADA)
- Campo booleano `lista_espera_habilitada` no cadastro da atividade, **padrao true**. Organizador pode desativar antes da abertura de inscricoes.
- Pedido sempre recebe ticket no SQLite depois de validacao; worker decide ao processar, em ordem FIFO. Se existe vaga, concede. Se esgotada, **habilitada** -> EM_FILA (sem ocupar vaga); **desabilitada** -> SEM_VAGA (encerrado, sem ocupar vaga).
- Cancelamento, recusa definitiva ou expiracao definitiva libera vaga e dispara processamento do menor ticket elegivel. Nunca pular tickets ativos por horario de chegada do navegador.
- No encerramento das inscricoes (no maximo no inicio da atividade), finalizar pedidos ainda sem vaga como SEM_VAGA e avisar assincronamente, sem manter fila indefinidamente.
- Regra de reenviar CPF + atividade: se ja ha pedido ativo na espera, retornar informacao neutra sem emitir ticket novo. Se CPF cancelou, expirou ou foi recusado definitivamente, nova intencao recebe ticket no fim da fila.

### P2 — Capacidade publicada e aplicada com versionamento (APROVADA)
1. Eventos cria atividade em estado NAO_PUBLICADA, versao de capacidade 1 e operation_id unico; persiste operacao PENDENTE **antes** de tentar sincronizar.
2. Worker simples/REST interno envia para Inscricoes `atividade_id, operation_id, expected_version=0, target_version=1, capacidade`. Inscricoes registra limite operacional transacionalmente. **Somente apos resposta confirmada** Eventos libera publicacao/inscricoes.
3. Para alterar atividade publicada, Eventos registra `nova_capacidade`, operation_id e target_version=current+1 como PENDENTE; publica ao organizador "alteracao pendente" e nao anuncia novo limite como efetivado.
4. Inscricoes serializa aplicacao de capacidade com worker FIFO sob lock da mesma atividade; rejeita reducao abaixo das vagas comprometidas (RESERVADO + EM_VERIFICACAO + CONFIRMADO). Ao aplicar, grava versao e resultado do operation_id na mesma transacao.
5. Se reenvio da mesma operacao, Inscricoes devolve resultado ja persistido; se versao esperada divergir, responde 409 com versao aplicada para conciliacao, jamais sobrescreve sem verificar. Enquanto houver uma alteracao pendente na atividade, **nao aceitar outra alteracao concorrente de capacidade** (simplificacao).
6. Eventos recebe resultado, atualiza capacidade publicada + versao e conclui a operacao. Se falha apos commit em Inscricoes, retry com mesmo operation_id recupera o resultado; ocupacao continua obedecendo limite operacional ja aplicado. API de consulta distingue limite EFETIVO e alteracao PENDENTE (sem anunciar sucesso antecipado).
7. Nao usar transacao distribuida nem acesso direto a banco alheio. Para rejeicao por ocupacao, marcar operacao REJEITADA e conservar capacidade anterior. Retentativas apenas para erro transitorio com resultado ainda incerto.

### P3 — Autenticacao e RBAC minimos (APROVADA)
- JWT assinado pelo servico Identidade com claims `sub` (usuario_id), `role`, `org_id` quando couber, `iss`, `aud`, `iat`, `exp`; nunca CPF no token.
- Prototipo: sessao curta em cookie HttpOnly + Secure + SameSite; expiracao sugerida de 30 min, login novamente apos expirar (sem refresh-token para demo). Segredo/chaves fora do Git.
- Gateway Fastify aplica `401` sem sessao, `403` para papel sem permissao, roteamento fixo a backend interno; servico de negocio valida titularidade ou organizacao do recurso, nao apenas o papel.
- Escritas via cookie exigem validacao Origin e token CSRF enviado em cabecalho; nao confiar apenas em SameSite. Chamadas internas autenticadas, sem aceitar header de identidade do navegador sem verificacao.
- Papeis minimos: PARTICIPANTE (proprias inscricoes); ORGANIZADOR (eventos da sua organizacao); ADMINISTRADOR (operacoes autorizadas e contingencia). Consultas publicas a eventos publicados nao exigem login.
- Provas: requisicao anonima protegida -> 401; participante consultando ticket alheio -> 403/404 sem vazamento; organizador editando evento de outra organizacao -> 403; administrador autorizando reembolso com auditoria.

**Estado:** P1/P2/P3 aprovadas no planejamento. Ainda em aberto: limites de campos, retencao da Idempotency-Key, cancelamento de evento, simulacao de e-mail/PIX/reembolso sem credenciais reais e parametros de execucao local. Esta aprovacao NAO autoriza implementar.

## Cenarios obrigatorios de teste (a planejar e executar somente apos aprovacao)
- **Concorrencia:** atividade com 30 vagas e 200 pedidos paralelos; no maximo 30 reservas ativas/confirmadas no mesmo instante e ordem de concessao consistente com ticket, tratando expiracoes.
- **FIFO:** concorrencia de pedidos, tickets unicos/ordenados por atividade e ausencia de ultrapassagem durante recuperacao.
- **Falha MySQL:** emular queda do container, registrar pedidos duraveis no SQLite, recuperar MySQL, conciliar e comprovar ausencia de duplicacoes.
- **Crash durante conciliacao:** interromper entre commit MySQL e marcacao no SQLite; repetir de forma idempotente.
- **Pagamento:** primeira recusa definitiva libera imediatamente; expiração definitiva tambem libera; pagamento tempestivo com callback atrasado preserva direito; timeout incerto entra em verificacao e nao libera vaga.
- **Cancelamento pago (DA-15):** confirmada e paga -> CANCELADO libera uma vaga, acorda proximo ticket, preserva pagamento e cria solicitacao administrativa de reembolso por Outbox idempotente, sem estorno automatico; durante EM_VERIFICACAO, pedido de cancelamento nao libera vaga ate conciliacao.
- **Escalonamento:** apos 15 min de verificacoes, alerta admin; simular Pix direto 30 min e confirmar so apos evidencia de credito.
- **Notificacoes fora do ar:** inscricao permanece confirmada e notificacao e reprocessada depois.
- **Watchdog:** falha controlada de servico e recuperacao/restricao de ate 3 tentativas; nunca reiniciar MySQL cegamente.
- **Autorizacao:** participante nao consulta dados de terceiros, organizador nao altera eventos de outra organizacao.
- **Integracao:** chamadas HTTP comprovando Node/Fastify e Python/FastAPI cooperando no mesmo fluxo.
- **Fila de espera (P1 APROVADA):** com 30 vagas e 200 pedidos, 30 concedidas e 170 em EM_FILA quando espera habilitada; com espera desabilitada, excedentes SEM_VAGA. Ao encerrar inscricoes, finalizar fila remanescente sem vagar/duplicar vagas; reingresso ao fim da fila.
- **Capacidade (P2 APROVADA):** criacao com versao 1 pendente nao aceita inscricoes; apos ACK, pode abrir. Diminuicao concorrente com concessao deve preservar ocupacao; falha entre ACK em Inscricoes e conclusao em Eventos retorna mesmo resultado sem reaplicar; impedir duas alteracoes simultaneas na mesma atividade.
- **Autorizacao (P3 APROVADA):** login valido/expirado, CSRF ausente, organizador de outro tenant e participante consultando inscricao alheia, todos sem acesso indevido ou vazamento de CPF.

## Evidencias para o relatorio de mestrado
- Contexto de dominio e justificativa de fronteiras/granularidade.
- Diagrama de contexto e de containers; sequencia da inscricao paga, recusa, timeout e falha MySQL.
- Contratos REST/eventos, propriedade de dados, idempotencia e erros.
- 3 a 5 ADRs e comparacao critica de alternativas (sem padroes de vitrine).
- Comandos reproduziveis Docker Compose, dados de exemplo, casos de teste e capturas/logs.
- Relatorio de aproximadamente 6 a 10 paginas (sugestao do enunciado), referencias verificadas, declaracao de uso de IA e roteiro de defesa oral.
- Explicar ganhos e custos da distribuicao: isolamento e evolucao versus consistencia eventual, latencia e maior complexidade operacional.

## Cronologia
- Enunciado: entrega ate sexta-feira, **06/11/2026**.
- Inicio deste registro no STI: **02/11/2026**.
- Proxima etapa: discutir os pontos em aberto um a um e atualizar os documentos, sem codigo ate aprovacao do plano.
