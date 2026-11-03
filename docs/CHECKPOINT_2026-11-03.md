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
