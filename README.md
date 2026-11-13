# EventHub

Plataforma de eventos em evolução como **produto real**, originalmente desenvolvida no Trabalho 2 de Arquitetura de Software (Mestrado UECE, entrega acadêmica em **06/11/2026**).

**Fonte canônica:** repositório privado `Boanerges20297/eventhub`, branch `main`. Desenvolvimento no STI01 por NEXO; **notebook e containers locais somente na etapa final autorizada**, após refinamento das telas, contratos e documentação. Não iniciar publicação pública implícita.

## Homologação local e apresentação — 12–13/11/2026

- O notebook foi conciliado por fast-forward com `origin/main` no commit `0778cf5`, preservando o backup de alterações locais. Segurança: OTP simulado em laboratório, dispositivo confiável, sessões e bloqueio após três tentativas incorretas.
- A tela de autenticação personalizada foi integrada à verificação OTP (sem voltar ao formulário provisório).
- Os logins de demonstração de **admin**, **organizer** e **participant** foram exercitados por HTTP real, com senha, OTP, sessão e logout. Credenciais permanecem **somente no notebook**, em `docs/TESTE_MOCK_ACESSOS_LOCAL.md` (ignorado pelo Git).
- Roteiro: [Apresentação e testes de 13/11](docs/APRESENTACAO_2026-11-13.md). Evidências: [Checkpoint integrado de 12/11](docs/CHECKPOINT_INTEGRACAO_SECURITY_2026-11-12.md). O resultado dos testes de backend não dispensa a homologação visual do navegador.
- Não há pagamentos, SMS, e-mails transacionais ou implantação pública reais.

## Situação em 04/11/2026

- **Cinco microsserviços implementados:** Identidade, Eventos, Inscrições, Pagamentos **simulados** e Notificações **simuladas**, combinando Node/Fastify e Python/FastAPI.
- **Infraestrutura definida:** Caddy como única entrada HTTP em `127.0.0.1:8088` no Compose local, Gateway Fastify, MySQL/InnoDB (um servidor, contas/schemas por serviço), SQLite persistente de tickets e worker FIFO.
- **Provas Docker anteriores (03/11):** fluxo HTTP autenticado, pagamentos/notificações simulados, falha recuperável e 200 requisições durante indisponibilidade real de MySQL para 30 vagas: **30 confirmados, 170 em fila, sem overbooking** no cenário isolado; consultar evidências e limites no checkpoint de 03/11.
- **Novas telas React (04/11):** navegação superior desktop e drawer mobile, catálogo com busca, organizador, inscrições e notificações; build e interações testados no Edge em larguras 320/390/700/701/1440 px.
- **Testes locais 04/11:** 69 testes Python executados (10 ignorados, sem falhas), 2 testes Node aprovados, build React aprovado. **Novos endpoints/frontend ainda precisam de E2E Docker final.**
- **Ainda não disponíveis:** pagamentos reais, SMTP real, Check-in, Certificados, Relatórios e implantação pública. Não confundir atividade simulada com transação financeira.

## Documentos principais

| Documento | Objetivo |
| --- | --- |
| [Arquitetura de Comunicação e Segurança de Rede](docs/ARQUITETURA_COMUNICACAO_SEGURANCA_REDE.md) | **Referência atual:** topologia, portas, matriz de conexões, fluxos Mermaid, autenticação/autorização, evidências e riscos |
| [Checkpoint 04/11](docs/CHECKPOINT_2026-11-04.md) | Estado atual, frontend, aprendizagem e pendências |
| [Checkpoint 03/11](docs/CHECKPOINT_2026-11-03.md) | Testes E2E, concorrência, failover, resultados e limitações |
| [Handoff de Frontend](docs/FRONTEND_HANDOFF_2026-11-04.md) | Telas, contratos de API e validações visuais |
| [Execução local](docs/EXECUCAO_LOCAL.md) | Operação **somente na fase final** do notebook; contém marcos históricos anteriores |
| [Planejamento e ADRs](docs/planejamento/README.md) | Decisões DA-00 a DA-18, contratos/estados propostos e ADRs; preservar como histórico de decisões |

## Estrutura essencial

- `frontend/src/api.js`: acesso same-origin a `/api`, sem endereços hardcoded de containers ou do notebook.
- `frontend/src/main.jsx`, `theme.css`, `EventHubMark.jsx`: interface e identidade C2 do EventHub.
- `services/node/`: Gateway, Identity, Events, Payments e verificação de JWT/CSRF/RBAC.
- `services/registrations/app/`: FIFO, SQLite, InnoDB, worker, conciliação, Outbox e isolamento por titular.
- `services/notifications/`: inbox simulada idempotente.
- `compose.yaml` e `infra/`: containers, redes e inicialização do MySQL/Caddy.
- `scripts/`: testes HTTP E2E, pagamentos, notificações, concorrência, contingência e validação visual.

## Regras de integridade e segurança

**O SQLite não concede vagas; MySQL/InnoDB é a autoridade de ocupação.** Um ticket durável significa pedido recebido, não vaga garantida. Operações usam idempotência, autorização por recurso, versão de capacidade e recuperação FIFO.

**A rede interna Docker não torna os serviços automaticamente seguros para a Internet.** O modelo atual usa HTTP interno e segredo compartilhado; o Compose local configura cookie sem `Secure` para HTTP loopback. O hardening público, TLS, rotação de chaves, rate limiting, backup/restore e watchdog ainda dependem de trabalho próprio. Ver a [matriz de riscos](docs/ARQUITETURA_COMUNICACAO_SEGURANCA_REDE.md).

Não guardar credenciais, tokens, CPF bruto ou dados pessoais sensíveis no Git; não apagar volumes, sobrescrever alterações humanas ou usar force-push para conciliar ambientes.

## Relatório acadêmico

[EventHub — Trabalho 2 (Google Drive)](https://docs.google.com/document/d/1_lwlon_uL-YsAR1mvd0VmmdM-slXDAzd/edit). O relatório registra os testes executados até 03/11; futuras revisões devem distinguir resultados realmente reexecutados de contratos e cenários apenas documentados.
