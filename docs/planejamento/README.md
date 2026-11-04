# EventHub — planejamento arquitetural

**Trabalho 2 / Wave 4 — Arquitetura de Software (UECE)**
**Prazo de entrega:** 06/11/2026
**Estado:** arquivo historico do planejamento aprovado. Implementacao AUTORIZADA pelo usuario em 02/11/2026; avancos e testes no README da raiz. A autorizacao nao implica deploy em producao.
**Atualizacao:** 02/11/2026.

## Objetivo
Plataforma de eventos academicos/profissionais: criacao de eventos e atividades; consultas; inscricoes gratuitas/pagas; capacidade e lista de espera; pagamentos simulados; notificacoes; check-in; certificados; relatorios.

O foco da entrega e defender uma arquitetura de microsservicos com fluxo executavel, testes de concorrencia e falhas, contratos, diagramas, ADRs e trade-offs. Requisito do enunciado: projetar cerca de 6 a 10 candidatos e implementar preferencialmente 4 a 6, com ao menos duas tecnologias de backend.

## Referencia atual de implementacao e seguranca

**Atenção:** este diretório preserva propostas e decisões de planejamento, algumas já superadas por código e testes posteriores. Para a topologia **AS-IS**, a matriz implementada de conexões, fluxos, mecanismos de defesa e riscos de produção, consultar [Arquitetura de Comunicação e Segurança de Rede](../ARQUITETURA_COMUNICACAO_SEGURANCA_REDE.md) (04/11/2026). Essa consolidação não modifica retroativamente as DAs/ADRs e não autoriza antecipar a integração no notebook.

## Documentos
- decisoes-arquiteturais.md — decisoes APROVADAS, justificativas e restricoes.
- fluxos-e-estados.md — inscricao, pagamento, fallback, observabilidade e diagramas conceituais.
- pendencias-e-validacao.md — pontos ainda NAO APROVADOS, riscos e evidencias exigidas.
- contratos-api.md — rascunho minimo de rotas, modelos, respostas e integracoes; campos/rotas ainda sujeitos a revisao.
- adrs-formais.md — cinco ADRs consolidados das decisoes JA APROVADAS; evidencias de testes ainda a produzir.

## Divisao aprovada dos componentes
- **Implementados (5 containers de backend):** Identidade (Node/Fastify), Eventos (Node/Fastify), Inscricoes (Python/FastAPI), Pagamentos (Node/Fastify), Notificacoes (Python/FastAPI).
- **Apenas modelados (3):** Check-in, Certificados, Relatorios.
- **Frontend:** React + Vite. **Persistencia:** container MySQL/InnoDB com bancos/usuarios separados + SQLite persistente para tickets/fallback. **Operacao:** watchdog com healthchecks.
- **Rede e seguranca:** backends, bancos e workers apenas na rede interna Docker; entrada HTTP(S) publica exclusivamente pelo Caddy (DA-12), que encaminha /api a gateway/middleware Node/Fastify (DA-13) para JWT e RBAC por rota; verificacao de pertencimento aos recursos continua em cada microsservico.

## Limite de escopo — diretriz explicita do projeto
O objetivo e uma entrega avaliavel de mestrado, e nao um produto industrial ou uma infraestrutura complexa. Toda complexidade deve estar ligada a requisito, risco critico ou evidencia de avaliacao.
- **Obrigatorio e demonstravel:** 5 servicos integrados em 2 stacks, reservas sem overbooking e FIFO por ticket, idempotencia de callbacks/retentativas, controle de autenticacao/autorizacao, isolamento de dados e Docker, testes de concorrencia/falha e ADRs.
- **Implementacao enxuta das decisoes ja aprovadas:** Caddy com roteamento simples; watchdog restrito aos containers do projeto com healthcheck/reinicio controlado; SQLite como emissor de tickets e fila de contingencia; Outbox e worker simples sem broker externo; MySQL unico com bancos/usuarios separados.
- **Nao adicionar sem justificativa e aprovacao:** RabbitMQ, Kubernetes, Redis, service mesh, monitoramento complexo, escalonamento automatico, multiplas VPS, mais microservicos executaveis ou padroes distribuidos extras.
- **Validacao antes de sofisticacao:** um fluxo ponta a ponta, teste de concorrencia, duplicidade de pagamentos e pelo menos uma falha recuperavel com evidencias verificaveis.
- Regra de corte: se algo consumir tempo sem cobrir criterio de avaliacao ou risco essencial, simplificar, modelar ou excluir, sem violar as regras de negocio ja aprovadas.

## Regra operacional
**Regra historica, valida apenas durante o planejamento anterior:** nao codificar sem autorizacao. A autorizacao para iniciar o MVP foi concedida em 02/11/2026, sem autorizacao automatica para deploy; este documento conserva o contexto das decisoes arquiteturais.

## Fonte
Discussao de planejamento com o usuario, a partir do enunciado 'Trabalho 2 — Wave 4, EventHub'. Este documento registra decisoes arquiteturais; nao representa implementacao ou validacao concluida.
