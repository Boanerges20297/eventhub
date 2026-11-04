# EventHub — checkpoint 04/11/2026 (transicao para produto)

## Contexto e fonte da verdade

Entrega do Trabalho 2 em 06/11/2026; enunciado exige sistema executavel, repositorio de codigo, contratos, testes, demonstracao e defesa. A partir de 04/11 o objetivo do usuario e evoluir o EventHub para uma plataforma de produto, sem descartar as decisoes arquiteturais aprovadas. O escopo academico nao deve ser confundido com prontidao para operar pagamentos reais em producao.

Repositorio privado: Boanerges20297/eventhub, branch main. Edicoes no STI01, validacao e Docker no notebook quando disponivel. Sem force push, PR automatico, GitHub Actions, remocao de volumes ou deploy externo implicito.

## Incremento de produto implementado no STI (04/11)

- Consulta persistente de inscricoes por titular, usando apenas dados da propriedade do servico Inscricoes no SQLite, inclusive durante falha do MySQL. Resposta limitada e paginada (limit 1..100, offset 0..10000), sem CPF, digest ou chaves de idempotencia.
- Novo GET interno /internal/inscricoes, autenticacao do usuario pelo gateway e roteamento GET /api/inscricoes?limit=&offset=.
- Painel React carrega historico de tickets ao reabrir a sessao, permite atualizar os estados e cancelar inscricoes elegiveis, respeitando as regras ja existentes do backend.
- Testes novos cobrem isolamento de titular, paginacao, persistencia apos reinicio e rejeicao de consulta sem limite.
- Testes executados no STI: Python unittest discover = 69 testes, 10 skipped, exit 0; Node security.test.js = 2 testes OK; Vite build exit 0; node --check gateway.js exit 0.
- Os testes locais nao substituem E2E no Docker: o fluxo via HTTP/gateway e o visual em navegador ainda precisam de validacao.

## Base anterior preservada

Em 03/11 foram aprovados os ensaios isolados da contingencia MySQL com 200 pedidos, 30 vagas, conciliacao SQLite/MySQL e sem overbooking, alem de notificacoes/Outbox e pagamento simulado E2E. Evidencias completas: CHECKPOINT_2026-11-03.md.

## Proximos incrementos de produto (por dependencia)

1. Validar nova listagem/reativacao de sessao/cancelamento por HTTP no Docker e confirmar sincronizacao com notebook.
2. Refatorar o frontend em modulos, navegacao responsiva, telas de catalogo, organizador, inscricoes e administracao, evitando que UI teste seja confundida com produto pronto.
3. Evoluir Eventos com cadastro completo (periodo, local, descricao, agenda, ciclo de vida) e painel de ocupacao para organizadores.
4. Implementar check-in, certificados condicionados a presenca e indicadores/relatorios, preservando ownership e isolamento de organizacoes.
5. Contingencia financeira documentada (15 minutos e PIX manual verificado), integracao de pagamento real somente apos especificacao segura, auditoria e ambiente adequado.
6. Preparar entregaveis academicos com capturas, scripts, API, roteiro e acesso controlado ao repositorio para avaliacao.

## Invariantes

MySQL/InnoDB decide ocupacao; SQLite emite tickets duraveis, jamais concede vagas. Preservar FIFO, idempotencia, exclusividade de bancos por servico, autenticacao/autorizacao, Outbox e registro de evidencia. Nenhum teste local prova disponibilidade irrestrita.

## Estilo visual em validacao conjunta (04/11)

Usuario escolheu **Claro elegante**: off-white #F8F7F3, azul #316FA9, tipografia escura #253E52 e superficies brancas. Implementado no STI `frontend/src/theme.css` e `frontend/src/main.jsx` com **navegacao superior horizontal**, hero editorial, vitrine de evento publicada com dados da API, cards apenas com dados existentes e formularios preservados. A proposta anterior com sidebar foi descartada por ser generica. Nao foram inventados indicadores financeiros ou de ocupacao.

**Evidencia visual efetiva no STI:** compilacao Vite exit 0; navegador Microsoft Edge via CDP no script `scripts/visual_capture.py`, alimentado por `scripts/visual_preview.py` (dados ficticios, localhost); screenshots `docs/eventhub-preview-desktop-1440.png` e `docs/eventhub-preview-mobile-390.png`. Metricas desktop: viewport 1440, scrollWidth 1425; mobile: viewport 390, scrollWidth 390; ambos sem overflow horizontal. O teste corrigiu uma limitacao do screenshot headless padrao do Edge que capturava 390 px de uma area interna de 492 px. Foi corrigida sobreposicao do elemento decorativo no card mobile. A identidade visual **ainda deve ser aprovada pelo usuario**; capturas sao da aplicacao React real com backend ficticio isolado, nao de producao. Build e diff check passam, e 69 testes Python foram executados (10 skipped, sem falhas). A integracao HTTP nova ainda requer Docker E2E.

## Marca C2 aprovada em 04/11

Apos rejeicao das alternativas anteriores, usuario **selecionou C2**, ingresso inclinado com estrela e arco em gradiente indigo/ciano, do painel de alternativas apresentado na conversa. Implementacao vetorial de interpretacao fiel em `frontend/src/EventHubMark.jsx` (sem raster ou imagem de marca temporaria). Nome aplicado na barra: **EventHub** (E e H maiusculos). Ajustado contraste do hero com azul-marinho #0B1939, indigo #18309F, texto de apoio mais escuro e ciano usado como realce/linha (nao texto claro sobre fundo claro). Identidade primaria permanece Claro elegante.

Validacao: `npm run build --prefix frontend` exit 0 (24 modulos); capturas reais via Edge/CDP: `docs/eventhub-c2-desktop-1440.png` (viewport 1440, scrollWidth 1425) e `docs/eventhub-c2-mobile-390.png` (viewport 390, scrollWidth 390); ambas sem overflow horizontal. `git diff --check` exit 0. Backend no preview sintetico isolado; testes Docker E2E pendentes, sem deploy. Marca C2 aprovada pelo usuario, composicao de tela ainda sujeita a avaliacao conjunta.
