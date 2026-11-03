# EventHub — checkpoint operacional (02/11/2026, Fortaleza)

## 0. Situacao e fontes

- **Entrega academica:** 06/11/2026. Aplicacao local no notebook; sem implantacao em VPS nesta etapa.
- **Repositorio canonico privado:** `Boanerges20297/eventhub`, branch `main`.
- **Fluxo de trabalho:** alteracoes no STI -> testes -> commit/push main -> pull --ff-only no notebook -> Docker/testes -> conciliacao e evidencia. Sem force push, sem reset, sem GitHub Actions.
- **STI:** `C:\Users\STI01\Desktop\Projetos\EventHub` (desenvolvimento). XAMPP/MySQL ja instalado, mas **nao e o banco do Compose do EventHub**.
- **Notebook:** `C:\Users\Boanerges\Desktop\Projetos\EventHub` (apresentacao Docker Desktop Linux). Apenas Caddy exposto em `http://127.0.0.1:8088`; MySQL e servicos em rede privada.
- **Segredos:** `.env` local ignorado pelo Git, gerado por `scripts/init-env.ps1`. Nunca publicar credenciais, CPF real ou valores do ambiente.
- Este documento e um **registro de estado e evidencia**, nao autorizacao de deploy em producao.

## 1. Feito e validado

| Subconjunto | Evidencia | Situacao |
|---|---|---|
| Arquitetura e ADRs | `docs/planejamento/`, decisao de cinco servicos implementaveis e tres modelados | Documentado |
| Git no STI e notebook | main igual ao remoto no marco `4007451` (anterior ao modulo de pagamentos integrado) | Sincronizado nesse marco |
| Docker local | 9 containers: mysql, identity, events, payments, registrations, registrations-worker, notifications, gateway, caddy | Em execucao no ultimo teste |
| MySQL 8.4/InnoDB | Volume persistente; cinco bancos e usuarios isolados | Validado localmente |
| SQLite de Inscricoes | Emissor unico de ticket, sequencia por atividade, CPF HMAC, idempotencia | Testado em concorrencia |
| Concessao de vagas | 200 tickets para 30 vagas: 30 RESERVADO, 170 EM_FILA, sem overbooking | `REAL_INTEGRATION_OK` no MySQL real |
| Worker de conciliacao | Processa FIFO; recupera ACK SQLite perdido; recusa/cancelamento/expiracao liberam e promovem | `WORKER_INTEGRATION_OK` |
| Autenticacao e autorizacao | Argon2id, JWT de 30 min, cookie HttpOnly, CSRF/Origin, RBAC e ownership | `HTTP_E2E_OK` |
| Eventos e atividades | CRUD minimo e sincronizacao de capacidade antes de publicar | `HTTP_E2E_OK` |
| Inscricoes via HTTP | 202/ticket, reenvio idempotente, consulta apenas titular, cancelamento e promocao FIFO | `HTTP_E2E_OK` |
| Interface React/Vite | Login, cadastro, eventos, atividade, inscricao, consulta de tickets | Build Vite passou; inspeccao visual manual PENDENTE |
| Privilegio REFERENCES | Corrigido so para `eventhub_events`; script de inicializacao ajustado para novos volumes | Events voltou a healthy |

**Resultado HTTP validado:** `HTTP_E2E_OK`; atividade sintetica `c0d02d2e-35a8-4d55-824b-f912b0700cd9`. Os testes demonstraram login, CSRF, RBAC, ownership, idempotencia, FIFO e promocao. Nao e um ensaio de carga HTTP completo.

**Testes locais (STI):** 44 testes Python (inclui 9 de regras de pagamento) e 2 testes Node de seguranca. Build React/Vite passou.

## 2. Etapa financeira em integracao — NAO concluir sem evidencia

- `services/registrations/app/payment_rules.py`: regras puras de PAGO tempestivo com callback tardio, RECUSADO_DEFINITIVO, EXPIRADO_DEFINITIVO, INDETERMINADO.
- `services/node/payments.js`: novo contrato de simulacao, tentativa persistida no banco `eventhub_payments`, idempotencia por identificador e reprocessamento.
- `services/registrations/app/capacity_store.py`: inicio em EM_VERIFICACAO antes do resultado e conciliacao atomica de evento financeiro, com ledger InnoDB. Outbox de notificacoes **nao implementado**.
- `services/registrations/sql/002_payment_events.sql`: esquema reproduzivel para eventos idempotentes.
- `services/registrations/app/main.py` e gateway: rotas internas de inicio/resultado e rotas autenticadas de simulacao.
- `frontend/src/main.jsx`: botoes de simulacao, expressamente sem cobranca real.
- `scripts/test_payments_e2e.js`: roteiro para provar PAGO, RECUSADO com promocao, INDETERMINADO mantendo vaga, idempotencia e titularidade.
- **Status inicial do checkpoint:** implementado e testado estaticamente no STI, **sem resultado de teste E2E financeiro no Docker ate a data deste registro**. Atualizar o documento apos a prova.

## 3. Invariantes contratuais e limites

- Ticket SQLite aceito **nao** concede vaga; MySQL/InnoDB e autoridade de ocupacao, sob lock.
- Reserva paga inicial de 30 min padrao, configuravel por atividade, contados da **concessao**.
- Primeira recusa definitiva libera imediatamente; sem segunda janela de 10 min.
- Timeout e callback incerto nao autorizam recusa; `EM_VERIFICACAO` conserva ocupacao.
- Pagamento confiavelmente ocorrido antes do prazo deve valer mesmo que callback chegue tarde; nao confirmar pagamentos tardios sem analise.
- Apos cancelamento/recusa/expiracao definitivos, reinscricao recebe NOVO ticket ao final da fila.
- Dados privados por servico; a simulacao permite escolher resultado por ser demonstracao local, portanto **nao e provedor de pagamento real nem apropriada para exposicao publica**.

## 4. Pendencias priorizadas ate 06/11 (na ordem)

1. **P0 — Validar pagamentos no Docker** com `PAYMENTS_E2E_OK`, cobrindo aprovado, recusa e promocao, incerto protegido, replay, ownership, reinicio e dados persistidos. Reparar falhas, registrar hash.
2. **P0 — Notificacoes + Outbox transacional:** inserir eventos junto com a alteracao de Inscricoes; worker de entrega idempotente e simulador de e-mail/log sem SMTP real. Falhas nao revertem inscricao.
3. **P0 — Recuperacao e degradacao:** perda do MySQL, tickets SQLite duraveis, retomada e ordenacao FIFO; crash apos commit MySQL e antes do ACK; sem aceite falso.
4. **P1 — Pagamento indeterminado e administracao:** reconciliacao intensiva 15 min + alerta; PIX manual de 30 min so com comprovacao verificada. Reembolso pago cancelado exige analise, nunca automatico.
5. **P1 — Testes integrados ampliados:** 200 pedidos simultaneos pela API para 30 vagas, retries concorrentes e callbacks duplicados, expiracao e capacidade versionada sob disputa; documentar resultados reais.
6. **P1 — Apresentacao:** roteiro de demonstracao com contas sinteticas, frontend manual/navegador, logs claros, uptime, reinicio, limitacao de memoria, relatorio academico atualizado.
7. **P2 — Operacao:** HTTPS/Caddy para eventual VPS, watchdog com no maximo 3 reinicios de servicos (nunca reiniciar MySQL cegamente), alerta, endurecimento das credenciais e testes de seguranca.
8. **Fora do MVP:** Check-in, Certificados e Relatorios continuam **somente modelados**.

## 5. Execucao e recuperacao sem destruir dados

No notebook, apos `git status --short` e validacao de que nao ha divergencia:

```powershell
git pull --ff-only origin main
.\scripts\init-env.ps1
docker compose config --quiet
docker compose up -d --build
docker compose ps
python -m unittest discover -s services/registrations/tests -q
node --test services/node/security.test.js
Get-Content -Raw .\scripts\test_http_e2e.js | docker compose exec -T identity node -
Get-Content -Raw .\scripts\test_payments_e2e.js | docker compose exec -T identity node -
```

- Executar os testes E2E em base local: eles geram dados sinteticos persistentes.
- **Nao usar `docker compose down -v`**, reset forcado de Git, nem expor a porta 3306.
- Se OCI subir mas API falhar: `docker compose ps`; `docker compose logs --tail=80 events registrations payments gateway`.
- Conta de organizador demonstrativa: consultar somente o **nome** `EVENTHUB_BOOTSTRAP_EMAIL` e a senha `EVENTHUB_BOOTSTRAP_PASSWORD` no arquivo local ignorado. Nunca colocar a senha em logs ou no checkpoint.

## 6. Referencias de marco

- `26369e4`: emissor SQLite e planejamento.
- `5821580`: capacidade InnoDB.
- `3dd792d`: Docker local e teste 200x30.
- `4dd7d04`: worker FIFO e promocao.
- `b983185`: auth + API eventos/inscricoes.
- `4007451`: regras financeiras puras e evidencia HTTP integrada.
- Relatorio Word academico: `EventHub_Trabalho_2_Referencias_Verificadas.docx` no Google Drive.
- Documentacao de execucao anterior: `docs/EXECUCAO_LOCAL.md`.

## 7. Checklist de conclusao da etapa

- [x] Confirmar commit `4007451` no remoto.
- [x] Validar 44 testes Python e build React/Vite no STI.
- [x] Preparar integracao financeira simulada nos dominios separados.
- [ ] Executar `PAYMENTS_E2E_OK` no Docker e registrar evidencias.
- [ ] Publicar commit final da etapa e confirmar STI = GitHub = notebook.
- [ ] Atualizar este checkpoint com hash final e status real.
