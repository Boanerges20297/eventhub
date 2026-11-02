# EventHub — contratos minimos de API (rascunho de implementacao)
**Data:** 02/11/2026 | **Estado:** PROPOSTA de contratos sobre regras DA-00..DA-14 aprovadas. Nomes de rotas, DTOs e codigos HTTP ainda nao foram individualmente aprovados. **Nao implementar ate liberacao integral.**

## 1. Topologia e convencoes
- Navegador -> HTTPS Caddy -> /api no Gateway Node/Fastify (JWT/RBAC) -> microsservicos internos via Docker.
- /internal/*: contratos **apenas entre servicos**, nao publicados pelo Caddy; autenticar origem de forma minima, mesmo dentro do Docker. Todos os servicos validam propriedade de recurso.
- Correlacao: cabecalho X-Request-ID; operacoes mutantes usam Idempotency-Key quando indicado. JSON com ids estaveis, timestamps ISO 8601 com offset e horario do servidor para auditoria.
- Erros padrao: 400 validacao, 401 nao autenticado, 403 proibido, 404 nao encontrado, 409 conflito de estado/capacidade/versao/chave, 503 indisponibilidade sem persistencia segura. Nao divulgar CPF de terceiros.
- Status 202 significa persistido e pendente; NAO significa vaga concedida. Reenvio de mesma chave/corpo devolve o mesmo ticket/status.

## 2. APIs externas minimas (roteadas pelo Gateway)
| Servico | Metodo e rota | Entrada / resposta resumida | Acesso |
|---|---|---|---|
| Identidade | POST /api/auth/login | credenciais -> sessao JWT em cookie HttpOnly/Secure/SameSite | publico |
| Identidade | GET /api/auth/me | -> usuario_id, papel, organizacao_id | autenticado |
| Eventos | GET /api/eventos | filtro opcional -> eventos publicados | publico |
| Eventos | POST /api/eventos | dados, organizacao -> evento_id | organizador da organizacao |
| Eventos | POST /api/eventos/{id}/atividades | nome, vagas, gratuita, preco, prazo_reserva_min -> atividade_id | organizador proprietario |
| Eventos | GET /api/atividades/{id} | -> atividade, capacidade, estado de disponibilidade | publico; ocupacao consultada/projetada por contrato |
| Eventos | PATCH /api/atividades/{id}/capacidade | operation_id, expected_version, capacidade -> PENDENTE/CONCLUIDO ou 409 | organizador proprietario |
| Inscricoes | POST /api/inscricoes | atividade_id, cpf; Idempotency-Key -> 202 inscricao_id, ticket (numero por atividade), estado REGISTRADO | participante |
| Inscricoes | GET /api/inscricoes/{inscricao_id} | -> numero_ticket, atividade_id, estado, reserva_expira_em, referencia_pagamento se autorizado | titular ou admin competente |
| Inscricoes | POST /api/inscricoes/{inscricao_id}/cancelar | -> CANCELADO ou 202 cancelamento_solicitado se pagamento ainda incerto; idempotente | titular/admin competente |
| Pagamentos | GET /api/pagamentos/{inscricao_id} | -> estado e referencia de cobranca, sem dados sensiveis | titular/admin competente |
| Pagamentos | PATCH /api/pagamentos/{inscricao_id}/reembolso | decisao administrativa, justificativa, valor/evidencia -> atualizacao auditada do caso | administrador autorizado; proposta de contrato |

**Resposta de pedido aceita:** HTTP 202, inscricao_id global (UUID para consultar), ticket sequencial **por atividade**, estado REGISTRADO e mensagem aprovada: "Sua solicitacao de vaga foi registrada. Assim que processarmos sua inscricao, voce recebera um e-mail com o resultado." **Motivo de usar inscricao_id na URL:** numero do ticket nao e globalmente unico, pois cada atividade possui sua propria sequencia.

## 3. Integracao interna, REST e workers
| Origem -> destino | Contrato proposto | Semantica essencial |
|---|---|---|
| Eventos -> Inscricoes | PUT /internal/atividades/{id}/capacidade com operation_id, expected_version, nova_capacidade | Em Inscricoes, lock/transacao junto ao FIFO; nova capacidade >= reservas ativas + confirmadas. Outcome por operation_id para retry idempotente. |
| Inscricoes -> Eventos | GET /internal/atividades/{id}/politica | Consultar regra/preco/capacidade publicados, sem banco cruzado; nova atividade nao aceita inscricao ate sincronizacao inicial. |
| Inscricoes -> Pagamentos | POST /internal/pagamentos/tentativas com inscricao_id, tentativa_id, valor, vencimento | Uma tentativa por identificador, provedor simulado e resposta correlacionada. |
| Pagamentos -> Inscricoes | POST /internal/inscricoes/resultados-pagamento com event_id, tentativa_id, status, pago_em, recebido_em | Dedupe event_id e transicoes atomicas. APROVADO no prazo confirma; RECUSADO_DEFINITIVO libera na primeira recusa; INDETERMINADO mantem em verificacao. |
| Outbox worker -> Notificacoes | POST /internal/notificacoes com event_id, tipo, destinatario_ref, ticket, dados_minimos | Deduplicar entrega; falha de email nao desfaz reserva/inscricao. |

**Cancelamento pago — contrato tecnico proposto:** apos Inscricoes confirmar CANCELADO com pagamento comprovado, registrar Outbox `INSCRICAO_PAGA_CANCELADA` com event_id e inscricao_id. Worker entrega a Pagamentos, que cria caso PENDENTE_ANALISE de modo idempotente. A entrega pode atrasar sem reter vaga; o administrador registra resultado e evidencia dentro de Pagamentos. Nenhum microsservico novo nem estorno automatico.

## 4. Invariantes obrigatorias
- **CPF + atividade:** no maximo um registro ativo (pedido/fila/reserva/verificacao/confirmacao); CPF normalizado e validado; restricao efetiva no SQLite emissor e MySQL Inscricoes, mesmo para cliques simultaneos.
- **Reinscricao (APROVADA):** apos CANCELADO/EXPIRADO/RECUSADO definitivos, nova Idempotency-Key e **novo ticket no final da fila**, sem garantia de vaga ou reaproveitamento da reserva anterior. Pagamento EM_VERIFICACAO nao e encerramento definitivo.
- **FIFO:** ticket unico por atividade emitido no SQLite; worker transacional e idempotente no MySQL; no modo degradado, aceitar pedidos duraveis SEM conceder vagas.
- **Capacidade:** cada vaga comprometida (reserva valida ou confirmada) contabilizada uma vez. Alterar limite usa operation_id + versao; sincronizacao pendente nao pode ser anunciada como concluida.
- **Pagamento RN03:** primeira recusa definitiva ou expiracao definitiva libera a vaga; nao ha janela adicional de 10 min. Timeout/callback incerto nao sao recusa e preservam a reserva ate conciliacao. Pagamento tempestivo comprovado vale com callback tardio.
- **RN02 APROVADA:** prazo da reserva e configuravel por atividade com **padrao de 30 minutos**, contado a partir da concessao; `prazo_reserva_min` e nome de campo **proposto** no contrato, sujeito a validacao de faixa/DTO.
- **Seguranca:** JWT no gateway e controle de dono/organizacao no servico; RBAC nao substitui ownership. Nenhum backend/DB com portas publicadas.

## 5. Contrato minimo do erro e dos estados
**Estados de Inscricoes PROPOSTOS** (ver tabela e guardas completas em fluxos-e-estados.md): REGISTRADO, EM_FILA, RESERVADO, EM_VERIFICACAO, CONFIRMADO, RECUSADO, EXPIRADO, CANCELADO, SEM_VAGA. **Estados de Pagamentos PROPOSTOS:** PENDENTE, PAGO, RECUSADO_DEFINITIVO, INDETERMINADO, EXPIRADO_DEFINITIVO. Notificacoes controla somente entrega. Resultado financeiro nunca altera ocupacao sem transacao validada em Inscricoes.
- O campo `inscricao_id` identifica o pedido globalmente; `numero_ticket` representa prioridade crescente por `atividade_id` e e apresentado ao usuario junto da atividade.
- `vencimento_reserva` e definido pelo servidor no ato da concessao, usando o prazo configurado na atividade (padrao 30 min).
- Retry da mesma Idempotency-Key/corpo retorna mesmo inscricao_id e numero_ticket; novo pedido com CPF + atividade ainda ativos, mesmo com chave diferente, nao cria outro ticket.
- `cancelar` durante EM_VERIFICACAO registra solicitacao pendente (202), sem liberar vaga ate resolver o resultado financeiro. No estado CONFIRMADO e com resultado financeiro ja apurado, o cancelamento valido libera UMA vaga (transacao) e pode gerar pedido de analise administrativa de reembolso, com auditoria.
- **DA-15 APROVADA:** nao ha devolucao automatica nem novo sistema financeiro; aprovacao e conclusao do eventual reembolso sao fatos administrativos distintos. Endpoint, DTO e nomes de estados acima permanecem PROPOSTOS para o prototipo com pagamentos simulados.
- 409 CPF_JA_INSCRITO: responder sem revelar ticket/dados a outro usuario; mesmo titular pode consultar o pedido existente.
- 409 CAPACIDADE_INSUFICIENTE: nova capacidade menor que ocupacao comprometida.
- 409 VERSAO_DESATUALIZADA / CHAVE_REUTILIZADA_COM_DADOS_DIFERENTES.
- 503 PERSISTENCIA_INDISPONIVEL: emissor SQLite indisponivel, nunca responder sucesso falso.

## 6. Fechamento de contratos para DA-16/DA-17/DA-18 [REGRAS APROVADAS, DETALHES DE DTO PROPOSTOS]
- **Eventos, atividade:** `lista_espera_habilitada: boolean` (padrao aprovado true), `inscricoes_encerram_em`, `prazo_reserva_min` (padrao aprovado 30), `capacidade`, `capacidade_version`, `sincronizacao: PENDENTE|CONCLUIDA|REJEITADA`.
- **Publicacao:** nova atividade inicia NAO_PUBLICADA com capacidade pendente de aplicar em Inscricoes. Somente publicar/abrir inscricao depois de confirmar versao 1 aplicada em Inscricoes. Abertura de inscricao em atividade nao sincronizada retorna conflito, sem emitir ticket.
- **Alterar capacidade:** `PATCH /api/atividades/{id}/capacidade` retorna `202 PENDENTE` com operation_id + versao alvo. `PUT /internal/atividades/{id}/capacidade` recebe operation_id, expected_version, target_version e nova_capacidade; confirma com versao aplicada ou `409` (ocupacao/versao). Eventos confirma publicacao depois do ACK; pedidos concorrentes de alteracao sao bloqueados ate resolver pendencia.
- **Fila:** com vaga e ticket elegivel, RESERVADO/CONFIRMADO. Com vagas esgotadas e espera habilitada, EM_FILA sem ocupacao. Com espera desabilitada, SEM_VAGA. No fechamento das inscricoes, pedidos ainda sem vaga passam a SEM_VAGA e notificacoes sao agendadas.
- **Auth:** JWT com `sub,role,org_id,iss,aud,iat,exp` e cookie HttpOnly+Secure+SameSite; sessao de 30 min e novo login apos expirar sao aprovados para o prototipo. Gateway aplica JWT/RBAC; recursos sao checados por Inscricoes/Eventos; escritas exigem CSRF e Origin valido.
- **Codigos:** 202 sincronizacao pendente; 409 versao desatualizada/capacidade abaixo da ocupacao/alteracao ja pendente; 401 nao autenticado; 403 nao autorizado. Respostas nao divulgam CPF/inscricao de outra pessoa.
- As regras DA-16, DA-17 e DA-18 foram aprovadas. Rotas especificas, validacoes de campos e detalhes de assinatura/chaves ainda sao propostas tecnicas; nenhuma implementacao autorizada.

## 7. Pontos que ainda precisam de fechamento tecnico
1. Retencao de chaves Idempotency-Key e restricao SQL apenas para estados ativos.
2. Detalhes de callback simulado, pagamento em verificacao e fluxo administrativo PIX; preservar regras ja aprovadas.
3. DA-17 aprovou versao 1, operacao persistida, retry idempotente e bloqueio ate sincronizacao; restam detalhes dos DTOs e politica de retentativas.
4. DA-18 aprovou claims minimas, CSRF/Origin, autenticacao interna e RBAC; restam detalhes da assinatura, chaves e tabela final de rotas.
5. Qual notificacao e demonstrada (outbox + simulador/local ou SMTP), sem dependencia de credenciais reais.
6. Campos e codigos finais: rascunho nao e especificacao implementada.

**Regra de escopo:** apenas o necessario para executar consulta -> inscricao -> reserva -> pagamento simulado -> confirmacao/recusa -> notificacao e testar concorrencia, falha e idempotencia.
