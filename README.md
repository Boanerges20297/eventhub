# EventHub

Trabalho 2 da disciplina **Arquitetura de Software** (Mestrado UECE), entrega prevista para 06/11/2026.

## Estado atual

Implementacao **iniciada e autorizada em 02/11/2026**. O primeiro modulo concluido e testado e o emissor persistente de tickets FIFO do servico Inscricoes. **O MVP integrado e o deploy ainda nao estao prontos.**

## Estrutura

- `docs/planejamento/`: decisoes DA-00 a DA-18, contratos, ADRs e fluxos aprovados no planejamento.
- `services/registrations/app/ticket_store.py`: emissao transacional de tickets por atividade em SQLite com CPF normalizado, HMAC, idempotencia e unicidade de inscricoes ativas.
- `services/registrations/app/capacity_store.py`: regras de capacidade e ingestao FIFO com bloqueio transacional InnoDB (testado com MySQL real no notebook; worker automatico pendente).
- `services/registrations/sql/001_initial.sql`: tabelas MySQL exclusivas de Inscricoes, com versao, ocupacao e unicidade ativa.
- `services/registrations/app/mysql_connection.py`: conexao por conta de menor privilegio, sem segredos no Git.
- `services/registrations/tests/`: 35 testes locais aprovados no STI (11 SQLite, 14 regras/contratos SQL, 3 verificacoes de seguranca e 7 testes do worker); integracao automatica no MySQL do notebook pendente.
- `scripts/test_integration.py`: teste reproduzivel no MySQL real do container (200 tickets, 30 reservas, 170 esperando, sem overbooking).
- `services/registrations/app/worker.py`: conciliacao SQLite/MySQL e processamento FIFO em processo separado, com recuperacao de ACK, promocao e expiracao (testes locais aprovados; integracao automatica no Docker a validar).
- `scripts/test_worker_integration.py`: teste real de recusa, cancelamento, expiracao e promocao automatica no Docker.
- `compose.yaml`, `infra/`, `frontend/`, `services/node/` e `services/notifications/`: infraestrutura Docker local com cinco servicos, gateway Fastify, Caddy e MySQL isolado. Ver `docs/EXECUCAO_LOCAL.md`.

## Testes locais (STI / Python 3.14)

```powershell
python -m unittest discover -s services/registrations/tests -v
```

O modulo SQLite **nao concede vagas nem confirma pagamentos**. O banco MySQL/InnoDB do servico Inscricoes sera a autoridade da ocupacao; o worker FIFO devera conciliar tickets em ordem, sem overbooking e com idempotencia apos falhas.

## MVP contratado — proximas etapas

1. Eventos (Node/Fastify): atividade, capacidade, publicacao sincronizada.
2. Inscricoes (Python/FastAPI): API interna, worker FIFO, reserva transacional MySQL, fallback SQLite e conciliacao.
3. Pagamentos simulados (Node/Fastify): recusa definitiva, expiracao e status incerto.
4. Identidade (Node/Fastify): JWT/RBAC, titularidade e CSRF, gateway Fastify.
5. Notificacoes (Python/FastAPI): entrega assincrona e Outbox.
6. Frontend React/Vite, Caddy e Docker Compose reproduzivel; testes de ponta a ponta e concorrencia.

Check-in, Certificados e Relatorios permanecem **modelados, nao implementados**.

## Relatorio academico

Versao Word com tres referencias externas verificadas:
[EventHub — Trabalho 2 (Google Drive)](https://docs.google.com/document/d/1_lwlon_uL-YsAR1mvd0VmmdM-slXDAzd/edit)

**Seguranca:** nunca gravar chaves, tokens ou dados de producao no Git. Nenhum deploy em producao esta implicito na autorizacao de iniciar o desenvolvimento.
