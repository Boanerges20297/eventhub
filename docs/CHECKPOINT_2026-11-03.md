# EventHub — checkpoint de continuidade (03/11/2026)

## Estado confirmado no inicio da sessao

- Codigo canonico no STI e no notebook: GitHub privado `Boanerges20297/eventhub`, `main` no marco `6dcb136`.
- Notebook Docker Desktop estava fechado; foi iniciado pelo usuario Windows. Os nove containers restauraram seus volumes persistentes.
- O teste `scripts/test_payments_e2e.js` executado contra gateway, Identity, Events, Registrations, Payments e MySQL devolveu `PAYMENTS_E2E_OK`.
- Atividade de teste sintetico: `6253f07c-7d9e-43d8-83ce-cf941ba7cfd5`.
- Evidencia validada: PAGO confirma, recusa definitiva libera e promove FIFO, INDETERMINADO protege vaga, replay idempotente, isolamento do titular.
- Assim, o marcador **Pagamento simulado E2E pendente** do checkpoint de 02/11 foi resolvido em 03/11; isso NAO e integracao com provedor real.

## Outbox transacional e notificacoes simuladas

Codigo desenvolvido no STI e posteriormente validado no Docker (evidencias na secao de 03/11 abaixo):
- `services/registrations/app/outbox.py`: tabela de outbox no banco de Inscricoes, gravacao na transacao de reserva/estado, entrega at-least-once com retry/backoff e ACK.
- `services/registrations/app/capacity_store.py`: grava evento no mesmo commit da concessao, promocao, cancelamento, pagamento e expiracao, com IDs de usuario/inscricao e estado, sem CPF ou email.
- `services/registrations/app/worker.py`: dispatcher envia por rede interna, nunca durante lock da vaga; falha na entrega nao desfaz operacao de inscricao.
- `services/notifications/app/store.py`: inbox independente no banco `eventhub_notifications`, deduplicacao por event_id, entrega simulada persistente.
- `services/notifications/app/main.py`: POST interno protegido para entrega, GET do proprio titular.
- Gateway e React/Vite: GET `/api/notificacoes` autenticado, lista manual no painel.
- `scripts/test_notifications_e2e.js`: verifica entrega de RESERVADO e CONFIRMADO, replay sem duplicacao e isolamento.
- `compose.yaml`: chave interna no worker e em Notificacoes, URL de rede interna, sem novas portas publicas.

## Evidencias e limitacoes atuais

- 48 testes Python no STI passaram (44 anteriores + 4 do contrato Outbox).
- Testes de compilacao Python/Node e build Vite passaram.
- **Atualizacao apos teste Docker:** `NOTIFICATIONS_E2E_OK` confirmado, com persistencia, confirmacao, deduplicacao e isolamento. Nao existe SMTP; notificacoes sao registros simulados no banco proprio.
- O contrato de Outbox usa entrega at-least-once e deduplicacao, nao exatamente-once distribuido.
- Nenhum dado real ou credencial incluidos no checkpoint.

## Roteiro de validacao executado em 03/11 (historico)

1. Commit/push pelo STI e `git pull --ff-only` no notebook apos confirmar `git status` limpo.
2. `docker compose up -d --build registrations registrations-worker notifications gateway caddy` no notebook, preservando volumes.
3. Executar `Get-Content -Raw .\\scripts\\test_notifications_e2e.js | docker compose exec -T identity node -`; observar `NOTIFICATIONS_E2E_OK`.
4. Reexecutar `test_http_e2e.js`, `test_payments_e2e.js`, testes Python e inspecionar logs de worker.
5. Atualizar checkpoint com hash final e evidencia real antes de iniciar testes de contingencia (MySQL offline e conciliacao FIFO).

## Validacao integrada apos rebuild — 03/11/2026

**Commit implementado:** `dd88b069ce97e35e46647cc5225e788e35f3cd56`.
Apos autorizacao explicita, executado no notebook:
`docker compose up -d --build registrations registrations-worker notifications gateway caddy`.
Nenhum volume foi removido.

Resultados observados no terminal Docker do notebook:

- `NOTIFICATIONS_E2E_OK activity=8140a7b6-3132-454e-b9e7-4a1c2ca9a672 persisted=true reserved=true confirmed=true dedupe=true isolation=true`
- `HTTP_E2E_OK event=cace47fb-16a6-4917-8ddf-02e67bbd1098 activity=4411d4e8-b888-442a-a65f-38a274227e78 auth=true csrf=true rbac=true idempotency=true ownership=true fifo=true promotion=true`
- `PAYMENTS_E2E_OK activity=5176533c-09b6-4bf4-a4b6-0d871465f37f approved=true refusal_promotes_fifo=true indeterminate_holds_seat=true idempotency=true ownership=true`

Antes da publicacao, `48` testes Python passaram e o frontend Vite compilou.
Apos o pull no notebook, `48` testes Python tambem passaram. Esses resultados
confirmam o fluxo funcional com eventos sinteticos e os contratos de seguranca
verificados pelos scripts. Nao comprovam resistencia a falhas fisicas ou carga
extrema.

**Status atualizado:** Outbox transacional e notificacoes SIMULADAS
**implementadas e validadas no E2E local**. Nenhum SMTP real ou provedor de
pagamento real esta habilitado.

**Proxima etapa, ainda PENDENTE:** ensaio controlado de queda do MySQL e do
servico Notificacoes, persistencia SQLite, retry da Outbox, retomada FIFO e
ausencia de overbooking. Fazer sem `docker compose down -v` e preservar os
dados de demonstracao. Em seguida, alerta de contingencia e roteiro final.

## Pendencias posteriores ate 06/11

- Contingencia MySQL/SQLite sob interrupcao real, recuperacao e FIFO sem overbooking.
- Falha financeira duradoura: janela de verificacoes, alerta apos 15 min, PIX manual de 30 min somente com verificacao de recebimento.
- Ensaios de concorrencia por API e replay de eventos; visual/UX da demonstracao, roteiro e documentacao academica.
- Publicacao em VPS fora do escopo da demonstracao local; nenhum deploy externo autorizado.

**Seguranca operacional:** nao executar `docker compose down -v`, reset forcado de Git, nem expor MySQL; env privado ignorado; STI para desenvolvimento, notebook exclusivamente para Docker e demonstracao.
## Ensaio real de contingencia MySQL (03/11/2026, NEXO/notebook)
- Execucao exclusivamente via NEXO no notebook, com Docker Desktop restaurado e os nove containers EventHub iniciados. Sem apagar volumes nem substituir dados anteriores.
- Baseline: `WORKER_INTEGRATION_OK` para cinco tickets sinteticos, capacidade 2, promocao por recusa/cancelamento/expiracao, convergencia SQLite/MySQL e ausencia de overbooking.
- Ensaio autorizado: `docker compose stop -t 10 mysql`; com MySQL parado, gravados quatro tickets de teste via `TicketStore.issue` no SQLite persistente da aplicacao (numeros 1, 2, 3 e 4; estado inicial `REGISTRADO`); `SQLITE_OUTAGE_WRITES_OK`, exit code 0.
- Recuperacao: `docker compose start mysql`, exit code 0. Logs do worker mostram `OperationalError` enquanto MySQL indisponivel e, depois, `ingeridos=4` na retomada automatica.
- Evidencia final: `MYSQL_SQLITE_RECOVERY_OK tickets=4 fifo=1,2,3,4 states=CONFIRMADO,CONFIRMADO,EM_FILA,EM_FILA occupancy=2/2 overbooking=false duplicates=false`, exit code 0. Os quatro estados coincidiram entre SQLite e MySQL; a atividade gratuita confirma diretamente os dois primeiros tickets.
- Atividade sintetica de verificacao: `a6bbdadf-254c-458a-8a9c-442996609f69`. A primeira tentativa de verificacao foi invalida porque `pending_for_activity` retorna apenas tickets pendentes; a segunda assumia `RESERVADO` para atividade gratuita. O verificador final foi corrigido para ler os quatro IDs por titular e aceitar `CONFIRMADO`.
- Estado pos-ensaio: MySQL e todos os demais nove containers em execucao; healthchecks disponiveis saudaveis. Arquivos locais preexistentes nao rastreados no notebook foram preservados.
**Limite da prova:** a gravacao na indisponibilidade foi feita diretamente no `TicketStore.issue` dentro do container `registrations`; NAO comprova que a rota publica de inscricao aceite pedidos durante queda total do MySQL. A implementacao de `register()` em `services/registrations/app/main.py` consulta antes o servico Eventos, dependente de MySQL. Investigar e ensaiar o caminho real de usuario antes de declarar contingencia fim a fim aprovada; nao contornar verificacao de atividade publicada sem um contrato de validade seguro.
**Ainda pendente:** ensaio de queda e retomada do servico Notificacoes/Outbox com retry e deduplicacao. Sua preparacao foi bloqueada por uma restricao de seguranca da ferramenta; nao houve parada do servico Notificacoes nem validacao de falha real. Manter tambem pendentes contingencia financeira apos 15 minutos, PIX manual verificado e roteiro final.

## Atualizacao de ensaios isolados — 03/11/2026 (eventhub-chaos)

Ambiente independente `eventhub-chaos` no notebook, porta local 18088, nove containers e volumes `eventhub-chaos_mysql_data` e `eventhub-chaos_sqlite_data`, separados do EventHub de demonstracao. Nao foram removidos volumes. E2E HTTP, pagamentos simulados, notificacoes e worker/FIFO passaram no ambiente isolado.

### Falha real de Notificacoes — APROVADO para o cenario ensaiado
- `docker compose -p eventhub-chaos stop -t 10 notifications`: servico interrompido; E2E convencional retornou 503, como esperado com o componente indisponivel.
- Outbox durante falha: 1 evento pendente e 2 tentativas registradas.
- `docker compose -p eventhub-chaos start notifications`: restaurado. Consulta apos recuperacao: evento `f5c2e27c-6ced-429a-873b-0a2f355733de` entregue com `attempts=3`, `delivered=1`, nenhum evento pendente; caixa do servico Notificacoes tinha exatamente 1 registro para o event_id.
- `NOTIFICATIONS_E2E_OK` apos recuperacao; healthcheck saudavel. Isso valida retry/entrega e deduplicacao nesse caso, nao indisponibilidade prolongada nem falhas simultaneas.

### Falha real MySQL e API — REPROVADO para admissao em modo degradado
- No `eventhub-chaos`, MySQL foi parado; POST autenticado na API interna de inscricoes respondeu `503 EVENTOS_INDISPONIVEL` (teste passou porque esperava comprovar o erro). MySQL restaurado e dois ambientes voltaram a HTTP 200.
- A validacao remota de atividade publicada em Eventos impede emitir novos tickets pela API durante indisponibilidade total de MySQL, apesar de `TicketStore.issue` funcionar isoladamente. **Bloqueador de contingencia fim a fim**; corrigir sem permitir inscricoes em atividades nao publicadas.

### Concorrencia pela API real — APROVADO para 40 requisicoes / 12 vagas
- Script versionado `scripts/test_api_concurrency_e2e.js` (commit `6fe4c15`), executado via `docker compose -p eventhub-chaos exec -T identity node -`.
- `API_CONCURRENCY_E2E_OK activity=5a7edc68-f192-4ae6-8c60-3170f4015e97 submitted=40 capacity=12 confirmed=12 waiting=28 unique=true fifo=true idempotent=true isolation=true elapsed_ms=4441`.
- Auditoria independente, leitura direta SQLite e MySQL: `API_CONCURRENCY_DB_AUDIT_OK sqlite={'CONFIRMADO': 12, 'EM_FILA': 28} mysql={'CONFIRMADO': 12, 'EM_FILA': 28} capacity=12 tickets_unique_sequential=true overbooking=false`, exit code 0.
- Limite: ensaio de 40 concorrentes nao e benchmark de throughput/carga extrema; nenhum teste de falha simultanea em pico foi executado.

**Proximos ensaios:** implementar/validar modo degradado pela API com cadastro autenticado de atividade publicada, testar carga maior e retries durante failover, falha entre commit MySQL e ACK SQLite em processo/container real, contingencia financeira de 15 minutos e PIX manual verificado, documentar resultados academicos.

## Correcao e prova fim a fim da contingencia pela API — 03/11/2026

- Correcao canonica publicada: commit `3b46c57` em `main`, sincronizado do STI para o notebook via `git pull --ff-only`. O EventHub principal nao foi reconstruido; apenas `events`, `registrations` e `registrations-worker` do ambiente isolado `eventhub-chaos`.
- Publicacao confirmada em Eventos e espelhada no SQLite, nao derivada unicamente de capacidade. Cache de publicacoes conhecido expira em no maximo 24h; resposta explicita 404/410 remove o espelho. Quando o MySQL/Eventos nao responde, a API permite apenas emissao local de ticket para atividade validada anteriormente, sem conceder vaga.
- Novos testes de cache: `13 tests OK` executados dentro de `eventhub-chaos-registrations`, com dependencias FastAPI presentes. Regressao isolada: `HTTP_E2E_OK`, `PAYMENTS_E2E_OK` e `NOTIFICATIONS_E2E_OK`.
- Ensaio E2E com tres usuarios e atividade publicada `bfffb1dd-7ffd-4038-940d-1e49e95f246f`, capacidade 2. Cache verificado no SQLite antes da interrupcao: uma linha, versao 1.
- MySQL isolado parado via NEXO, executando fase `during` pelo Gateway. Saida: `DEGRADED_E2E_DURING_OK submitted=3 locally_registered=3 unknown_rejected=true fifo=true`, exit code 0. Uma atividade desconhecida foi rejeitada, sem ticket. Os dados de autenticacao da fase foram mantidos apenas em variavel de sessao, nao no repositorio.
- O bloco `finally` do comando original restaurou o MySQL com `MYSQL_RESTART_EXIT=0`. Houve bloqueio temporario de leitura pelo NEXO; em terminal novo, `nexo control on` habilitou o controle, e a verificacao confirmou ambos MySQL (principal e isolado) `healthy`.
- Fase `after`: `DEGRADED_E2E_RECOVERY_OK confirmed=2 waiting=1 fifo=true overbooking=false`, exit 0.
- Auditoria independente dos bancos: `DEGRADED_DB_AUDIT_OK sqlite=[(1,'CONFIRMADO'),(2,'CONFIRMADO'),(3,'EM_FILA')] mysql=[(1,'CONFIRMADO'),(2,'CONFIRMADO'),(3,'EM_FILA')] capacity=2 fifo=true overbooking=false`, exit 0.
- Estado final: ambos ambientes com nove containers em execucao; endpoints locais `http://127.0.0.1:18088/api/health` e `http://127.0.0.1:8088/api/health` HTTP 200. Nao houve `down -v` nem remocao de volumes.

**Conclusao limitada:** modo degradado pela API, com publicacao previamente validada, e conciliacao FIFO apos falha real MySQL foram APROVADOS no cenario de tres usuarios. Permanecem sem prova: carga intensa durante falha, revogacao concorrente ao cache (janela de ate 24h), crash real entre commit MySQL e ACK SQLite, failover combinado e contingencia financeira/PIX manual. Nao declarar disponibilidade irrestrita nem garantia distribuida de exatamente-uma-vez.

## Encerramento do dia — teste 200 participantes / 30 vagas em falha real MySQL (03/11/2026)

**Ambiente:** apenas `eventhub-chaos`, notebook; `eventhub` principal preservado. Testes sinteticos e atividades isoladas. Fonte do script: `scripts/test_degraded_load_200_e2e.js` (commit `770f52a`); unidade de cache/lease: `services/registrations/tests/test_publication_lease_limits.py` (6 testes adicionais OK). Correção de timeout publicada a partir do STI no commit `58d9510` e sincronizada com notebook por `git pull --ff-only`. Apenas o gateway isolado foi reconstruido e validado como `healthy`; teste funcional `HTTP_E2E_OK` regressao exit 0.

1. **Primeiro ensaio (falha HTTP real, anterior a correcao):** 200 `POST /inscricoes` simultaneos, MySQL chaos desligado. `LOAD_DURING_COUNTS {"503":200}`, sem excecoes cliente, aproximadamente 5,557 s. Causa localizada: `requestTo` do Gateway encerrava chamadas apos `AbortSignal.timeout(5000)`, devolvendo `503 SERVICO_INDISPONIVEL`, ainda que o backend continuasse o processamento. `LOAD_E2E_FAILED`, exit 1. Apos restauracao: consulta direta SQLite e MySQL mostrou 200 tickets exclusivos 1-200, 30 `CONFIRMADO` (tickets 1-30), 170 `EM_FILA` (31-200), capacidade 30. **Resultado: HTTP reprovado, durabilidade e conciliacao observadas corretas**. Resposta HTTP 503 nao significa ausencia de commit; a intencao deve preservar `Idempotency-Key` em retries.
2. **Correcao pontual (commit `58d9510`):** timeout de 45 s apenas na rota `POST /inscricoes`; 5 s mantidos nas demais rotas. O teste salva as chaves de idempotencia antes do envio para repetir operacoes ambíguas com a mesma intencao. Gateway reconstruido apenas no compose `eventhub-chaos`. `GATEWAY_TIMEOUT_45000_PRESENT`, `HTTP_E2E_OK`, codigos 0.
3. **Segundo ensaio com atividade nova** `a6b46117-7e4f-4292-a184-7bf13a9b9615` (200 pessoas autenticadas, 30 vagas, publicacao confirmada em cache version 1, sem tickets preexistentes). Com MySQL chaos parado: `LOAD_DURING_COUNTS {"202":200} exceptions=0 elapsed_ms=7069` para o lote inicial. Etapa completa, incluindo cinco reenvios idempotentes e rejeicao de atividade desconhecida: `LOAD_DURING_OK submitted=200 capacity=30 unique=true fifo=true degraded=true unknown_rejected=true replay=true elapsed_ms=31207`, exit 0. Retorno 202 nao promete vaga; apenas ticket duravel.
4. **Restauracao e reconciliacao:** `MYSQL_RECOVERY_EXIT=0`; fase `after` respondeu `LOAD_RECOVERY_OK submitted=200 confirmed=30 waiting=170 fifo=true overbooking=false`, exit 0. Consulta independente, via SQLite e MySQL: `STRESS_DB_AUDIT_OK sqlite_count=200 mysql_count=200 capacity=30 confirmed=30 waiting=170 tickets_unique_sequential=true sqlite_mysql_equal=true fifo=true overbooking=false`, exit 0. MySQL chaos e principal `healthy`, endpoints HTTP 18088 e 8088 com codigo 200. Nao houve `down -v`, remocao de volumes nem reconstrucao do ambiente principal.
5. **Conclusao academica:** **APROVADO NO CENARIO ENSAIADO**, para 200 clientes em rajada + falha MySQL isolada, com corretude observada de fila e ocupacao. O primeiro ensaio fracassado permanece registrado como evidencia de falha recuperada. O lease de publicacao (ate 24 h) nao garante revogacao instantanea durante particao; MySQL e VPS continuam SPOFs. Nao foram testados: grande escala alem de 200, crash exato entre commit MySQL e ACK SQLite, falha simultanea de outros servicos, PIX manual/reconciliacao financeira real, revalidacao de publicacao revogada durante particao, desempenho sustentado. Nao alegar exatamente-uma-vez distribuido.
6. **Relatorio do trabalho — ATUALIZADO E VERIFICADO:** documento `EventHub_Trabalho_2_Referencias_Verificadas.docx` na pasta Google Drive `Trabalho 2 - EventHub`, atualizado em 03/11/2026; contem o primeiro ensaio 200x503 como falha diagnosticada, segundo ensaio 200x202 como resultado aprovado, auditoria SQLite/MySQL e limites, sem apagar as evidencias anteriores. Leitura posterior do Drive confirmou texto atualizado. URL: https://docs.google.com/document/d/1_lwlon_uL-YsAR1mvd0VmmdM-slXDAzd/edit
