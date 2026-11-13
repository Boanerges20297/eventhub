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

## Refinamento de telas sem notebook/container local (04/11)

O usuario determinou que **o acoplamento e a demonstracao dos containers no notebook ocorram somente ao final**. Nesta fase foi implementado o drawer esquerdo mobile, mantendo navegacao superior desktop, e separadas as telas de inicio, catalogo, organizacao, inscricoes e atualizacoes, alem de acesso. Contratos HTTP centralizados em `frontend/src/api.js`, apenas no gateway `/api`. Novos componentes `frontend/src/ScreenHeading.jsx` e fluxo de atividades selecionadas pelo titulo. Estado vazio em notificacoes, busca por evento e cards refinados. Fluxos nao existentes (check-in, certificados, relatorios) NAO foram anunciados como disponiveis.

Evidencias interativas no STI: Vite 26 modulos compilados, teste `python scripts/test_frontend_navigation.py` exit 0 cobrindo navegacao no drawer, Escape, overlay, foco, scroll, catalogo, organizador, selecao de atividade para inscricao, notificacoes e escritorio; mobile 390 e desktop 1440 sem overflow. Python 69 testes/10 skipped; Node 2/2; sem Docker/notebook ou deploy. Evidencias e pendencias completas em `docs/FRONTEND_HANDOFF_2026-11-04.md`.

## Auditoria documental de rede e seguranca (04/11)

Criado `docs/ARQUITETURA_COMUNICACAO_SEGURANCA_REDE.md`, documento consolidado com topologia Compose/Caddy **AS-IS**, matriz de portas, conexoes HTTP internas, fluxos Mermaid, limites de confianca (JWT, CSRF, Origin, RBAC, titularidade), propriedade de dados, redundancia/contingencia e checklist da integracao final. Documenta explicitamente riscos: segredo `EVENTHUB_INTERNAL_SECRET` compartilhado; `X-EventHub-Auth` em Base64URL sem assinatura independente; HTTP interno sem mTLS; cookie Secure=false exclusivo do HTTP loopback; ausencia de rate limit identificado e falta de watchdog efetivo, apesar do healthcheck e restart. Isso nao implica autorizacao de publicar o sistema. Sem testes Docker, notebook ou VPS nesta etapa.

## Continuidade após autorização de uso do notebook (04/11)

- STI, GitHub e notebook sincronizados previamente em `main` commit `706e3dc`; foram executados E2E HTTP, pagamentos/notificações simulados e verificações de rede no notebook, com resultados aprovados e volumes intactos. O usuário determinou encerrar repetições de ensaios antigos e priorizar o produto.
- **Novo trabalho local ainda não enviado ao remoto:** espaço de gestão do organizador, com lista de eventos privados/rascunhos, edição de metadados, sincronização de atividades pendentes e ocupação agregada proveniente de Inscrições. Novas rotas com RBAC/ownership; não editar capacidade diretamente.
- Frontend: `OrganizerWorkspace.jsx`, `organizer.css` e chamadas em `api.js`; Gateway e Eventos adicionam rotas `/me/`; API Inscrições expõe apenas contagens agregadas internas. Ver `docs/FRONTEND_HANDOFF_2026-11-04.md`.
- Validação direcionada estática/visual **aprovada**: Vite 28 módulos, verificação de sintaxe Node/Python, captura Edge/CDP com dados sintéticos (390/1440px), `ORGANIZER_UI_OK` exit 0. Os caches criados pelo CDP são ignorados, sem exclusão de artefatos humanos.
- **Integração do módulo concluída localmente no notebook:** `docker compose up -d --build` autorizado e executado em 04/11, sem remoção de volumes; Caddy, Gateway, Events, Registrations e dependências reconstruídos e iniciados por healthchecks. `Get-Content -Raw scripts/test_organizer_workspace_e2e.js | docker compose exec -T identity node -` → **`ORGANIZER_WORKSPACE_E2E_OK`, exit 0** (`draft=true`, `owner_scope=true`, `edit_event=true`, `edit_activity=true`, `published=true`, `summary=true`, `occupied=1`, `free=2`, `participant_denied=true`). Apenas o fluxo novo foi retestado, por decisão do usuário. O E2E cria evento, atividade e participante **sintéticos persistentes na instância de desenvolvimento**; não os apagar automaticamente. `eventhub-chaos` fica reservado para falhas destrutivas. **Não implica produção pública/homologação.**

## Gestão de inscrições pelo organizador — incremento funcional (04/11)

- Nova consulta **somente leitura** por atividade, disponível apenas ao organizador proprietário ou administrador. `GET /api/me/atividades/{id}/inscricoes?limit=20&offset=0&estado=CONFIRMADO` → Gateway (RBAC) → Eventos (verificação da organização) → Inscrições (MySQL de seu próprio domínio).
- Sem consulta SQL cruzada: a API retorna exclusivamente `inscricao_id`, `numero_ticket`, `estado`, total e paginação. Nenhum CPF, hash, email ou `user_id` é devolvido. Limite 1–100, offset 0–10000, estados validados; ordenação por ticket FIFO.
- UI: `OrganizerRegistrations.jsx` incorpora acompanhamento por atividade com filtro de estado, atualização e paginação; formulário responsivo e avisos explícitos de que a lista contém **apenas pedidos já processados no MySQL**, não necessariamente tickets exclusivamente pendentes no SQLite.
- Validação **não destrutiva** realizada: build Vite 30 módulos, sintaxe Node e Python, `git diff --check`, Edge/CDP `ORGANIZER_UI_OK` exit 0 para lista visual e responsividade em desktop/mobile com dados sintéticos. O E2E direcionado `scripts/test_organizer_registrations_e2e.js` foi executado após reconstrução autorizada dos containers principais e passou: **`ORGANIZER_REGISTRATIONS_E2E_OK`, exit 0**, `total=4`, `confirmed=2`, `waiting=2`, `pagination=true`, `filtering=true`, `privacy=true`, `participant_denied=true`, `invalid_filters_rejected=true`. Cria um evento e quatro participantes sintéticos persistentes no ambiente local, não remove volumes nem interfere no projeto `eventhub-chaos`.
- Evidência final: interface mock validada em desktop/mobile e API real autenticada validada por Gateway → Eventos → Inscrições. A fase de publicação pública continua fora do escopo desta rodada. `eventhub-chaos` permanece reservado à contingência.

## Preparação de contas e massa sintética para demonstração (04/11)

- Fluxo **AS-IS** verificado: `POST /api/auth/register` só cria `participant`; `organizer` aparece pelo bootstrap/seed controlado e `admin` não é autopromovível. "Cliente" no MVP é o perfil `participant`. Documentação específica: `docs/DEMO_USUARIOS_E_FLUXO.md`.
- Criado `scripts/seed_demo_eventhub.js`, protegido por opt-in `EVENTHUB_ENABLE_DEMO_SEED=1`, checagem do banco exclusivo `eventhub_identity` e execução local em container. Nove contas de exemplo (um administrador, dois organizadores em organizações separadas, seis clientes), três eventos, atividades gratuitas e pagas simuladas, tickets confirmados, reservas e fila. Todos os dados são sintéticos e os contratos de Eventos/Inscrições são consumidos exclusivamente via Gateway.
- **Primeira execução efetiva** retornou `DEMO_SEED_OK accounts=9 events=3 registrations_new=12 registrations_existing=0`, evidenciando gravação de registros nos domínios locais. Porém a sessão de Node manteve conexão MySQL aberta e o pipeline PowerShell foi interrompido; o arquivo local ignorado `.demo-credentials.local.json` ficou com zero bytes. **As credenciais destas contas não foram recuperadas**; não declarar o acesso de demonstração concluído. O script foi corrigido para fechar o pool e finalizar após escrever as credenciais, mas a nova execução ainda não foi confirmada por causa da instabilidade do terminal NEXO.
- Pendências prioritárias: executar novamente o seed corrigido, validar a existência e contagem das nove credenciais geradas no notebook **sem imprimir senhas**, confirmar login dos três papéis, verificar idempotência e integrar o código ao GitHub/STI. Não armazenar senhas em Git/Drive; o arquivo local está no `.gitignore`.

### Correção do armazenamento das credenciais demo (04/11)

- `scripts/seed_demo_eventhub.js`: pool MySQL encerrado e saída explícita; nove senhas geradas em cada execução, hash Argon2 no Identity, login autenticado de todos os perfis antes de persistir os acessos; credenciais são produzidas como arquivos privados em `/tmp` do container, **sem imprimir senhas no terminal**.
- `scripts/seed-demo.ps1`: comando único via Docker no notebook que executa seed opt-in, copia o JSON para `.demo-credentials.local.json` (ignorado no Git) e cria o documento com logins e senhas em `docs/TESTE_MOCK_ACESSOS_LOCAL.md` (dentro do projeto e ignorado no Git); valida nove contas e três eventos.
- **Execução comprovada (NEXO, 04/11):** `& .\scripts\seed-demo.ps1` retornou `DEMO_SEED_OK accounts=9 events=3 registrations_new=12 registrations_existing=0` e `DEMO_MOCK_READY accounts=9 events=3 roles=admin=1,organizer=2,participant=6`. As nove credenciais foram testadas por login no seed. Arquivos privados verificados: `docs/TESTE_MOCK_ACESSOS_LOCAL.md` (2258 bytes) e `.demo-credentials.local.json` (3790 bytes), ambos ignorados pelo Git. As 12 inscrições são solicitações criadas; os totais agregados após conciliação devem ser verificados separadamente.
- **Idempotência do seed confirmada:** segunda execução `DEMO_SEED_OK accounts=9 events=3 registrations_new=0 registrations_existing=12` e `DEMO_MOCK_READY accounts=9 events=3 roles=admin=1,organizer=2,participant=6`. As senhas foram renovadas e o documento privado foi atualizado. Consulta agregada após a conciliação mostrou: Oficina de microsserviços: 2 confirmadas e 3 em fila; Laboratório pago: 3 reservas; Docker: 4 confirmadas; Mesa-redonda: 0. Nenhum pedido duplicado no segundo seed. `.dockerignore` passou a excluir o JSON local de credenciais do contexto de build.
