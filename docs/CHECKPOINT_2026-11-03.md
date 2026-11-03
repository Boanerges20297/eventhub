# EventHub — checkpoint de continuidade (03/11/2026)

## Estado confirmado no inicio da sessao

- Codigo canonico no STI e no notebook: GitHub privado `Boanerges20297/eventhub`, `main` no marco `6dcb136`.
- Notebook Docker Desktop estava fechado; foi iniciado pelo usuario Windows. Os nove containers restauraram seus volumes persistentes.
- O teste `scripts/test_payments_e2e.js` executado contra gateway, Identity, Events, Registrations, Payments e MySQL devolveu `PAYMENTS_E2E_OK`.
- Atividade de teste sintetico: `6253f07c-7d9e-43d8-83ce-cf941ba7cfd5`.
- Evidencia validada: PAGO confirma, recusa definitiva libera e promove FIFO, INDETERMINADO protege vaga, replay idempotente, isolamento do titular.
- Assim, o marcador **Pagamento simulado E2E pendente** do checkpoint de 02/11 foi resolvido em 03/11; isso NAO e integracao com provedor real.

## Outbox transacional e notificacoes simuladas

Codigo preparado no STI (ainda a validar no Docker):
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
- **Ate validar em Docker:** nao declarar `NOTIFICATIONS_E2E_OK`, nem email real enviado. Nao existe SMTP; notificacoes sao registros simulados no banco proprio.
- O contrato de Outbox usa entrega at-least-once e deduplicacao, nao exatamente-once distribuido.
- Nenhum dado real ou credencial incluidos no checkpoint.

## Prioridade imediata para continuar

1. Commit/push pelo STI e `git pull --ff-only` no notebook apos confirmar `git status` limpo.
2. `docker compose up -d --build registrations registrations-worker notifications gateway caddy` no notebook, preservando volumes.
3. Executar `Get-Content -Raw .\\scripts\\test_notifications_e2e.js | docker compose exec -T identity node -`; observar `NOTIFICATIONS_E2E_OK`.
4. Reexecutar `test_http_e2e.js`, `test_payments_e2e.js`, testes Python e inspecionar logs de worker.
5. Atualizar checkpoint com hash final e evidencia real antes de iniciar testes de contingencia (MySQL offline e conciliacao FIFO).

## Pendencias posteriores ate 06/11

- Contingencia MySQL/SQLite sob interrupcao real, recuperacao e FIFO sem overbooking.
- Falha financeira duradoura: janela de verificacoes, alerta apos 15 min, PIX manual de 30 min somente com verificacao de recebimento.
- Ensaios de concorrencia por API e replay de eventos; visual/UX da demonstracao, roteiro e documentacao academica.
- Publicacao em VPS fora do escopo da demonstracao local; nenhum deploy externo autorizado.

**Seguranca operacional:** nao executar `docker compose down -v`, reset forcado de Git, nem expor MySQL; env privado ignorado; STI para desenvolvimento, notebook exclusivamente para Docker e demonstracao.
