# EventHub — Entrega intermediária de frontend e contratos (04/11/2026)

## Decisão de sequência aprovada

**Não usar o notebook nem integrar containers locais nesta fase.** O desenvolvimento e a validação de UI são realizados **no STI01, exclusivamente via NEXO**. A montagem final do ambiente local para demonstração e testes integrados fica como última etapa. Não usar GitHub Actions, PR ou pipeline de CI.

O EventHub é um **produto real em evolução**, não uma página descartável apenas para a disciplina. Telas devem ter fluxos legítimos e nunca exibir recursos inexistentes como operacionais.

## Identidade visual e navegação

- Marca **EventHub**, opção C2 aprovada: ingresso vetorial índigo/ciano, `frontend/src/EventHubMark.jsx`, sem dependência de imagem raster.
- Linguagem **Claro elegante**: superfícies off-white/brancas, tipografia escura, destaques em índigo com ciano. Headline revisada para alto contraste.
- Desktop: navegação horizontal; mobile <=700px: botão hambúrguer com drawer à esquerda.
- Drawer: overlay, X, Escape, clique externo e navegação fecham o painel; rolagem de fundo bloqueada; foco inicial no controle de fechamento; trap de Tab; retorno ao hambúrguer ao fechar sem navegar; animação breve e suporte a `prefers-reduced-motion`.
- O cabeçalho secundário autenticado é ocultado no mobile. Encerrar sessão fica acessível pelo drawer. A marca permanece visível.

## Telas com implementação visual e integração pelo gateway

| Tela | Situação | Rotas utilizadas |
| --- | --- | --- |
| Entrar / criar conta | Formulários funcionais com validação nativa | `POST /api/auth/login`, `POST /api/auth/register`, `GET /api/auth/me`, `POST /api/auth/logout` |
| Início | Hero, vitrine do catálogo e indicadores baseados apenas em dados retornados pela API | `GET /api/eventos`; histórico pessoal de inscrições quando aplicável |
| Explorar eventos | Busca local por nome, cartões por evento, expansão de atividades e seleção para inscrição | `GET /api/eventos`; `GET /api/eventos/:id/atividades` |
| Organizar | Criação de evento e atividade em duas etapas; preço demonstrativo identificado | `POST /api/eventos`; `POST /api/eventos/:id/atividades` |
| Minhas inscrições | Atividade em seletor pelo título, solicitação, tickets persistentes, consulta, cancelamento e simulação de pagamento claramente rotulada | `POST /api/inscricoes`; `GET /api/inscricoes?limit=50&offset=0`; `GET /api/inscricoes/:id`; `POST /api/inscricoes/:id/cancelar`; `POST /api/pagamentos/:id/simular` |
| Atualizações | Estado vazio explícito antes/depois do carregamento, leitura de notificações simuladas | `GET /api/notificacoes` |

Essas telas existem no React; **não presumir que integrações reais foram reexecutadas** após os novos ajustes apenas porque o mock respondeu.

**Documentação de rede e segurança:** a matriz de comunicação, limites de confiança e riscos de produção estão consolidados em [Arquitetura de Comunicação e Segurança de Rede](ARQUITETURA_COMUNICACAO_SEGURANCA_REDE.md). A integração no notebook continua explicitamente reservada para a etapa final.

## Contrato único de integração

`frontend/src/api.js` é a fachada HTTP do React, com `requestApi()` e mapa `routes`. Endereços de containers, portas, IPs de notebook ou bancos **não são codificados no frontend**. Requisições usam a mesma origem `/api` do gateway, `credentials:'same-origin'`, token CSRF recebido com a sessão em operações de escrita e `Idempotency-Key` nas operações que o exigem.

A API de histórico de inscrições limita resultados a 50 itens na interface atual; backend suporta paginação e isolamento por usuário. A navegação mantém estado de tela e hash; o catálogo carrega atividades sob demanda. O backend decide capacidade e filas, nunca o frontend.

## Validação visual realizada no STI

- `npm run build --prefix frontend`: **exit 0**, Vite compilou 26 módulos.
- `python scripts/test_frontend_navigation.py http://127.0.0.1:48763/`: **exit 0**; testa drawer, Escape, foco, clique externo, rotas por seleção, carregamento de atividades, seleção para inscrição, visual mobile e desktop, sem overflow horizontal.
- `python -m unittest discover -s services/registrations/tests -q`: 69 executados, **10 ignorados, zero falhas**.
- `node --test services/node/security.test.js`: 2 testes aprovados.
- Edge/CDP responsivo: larguras **320, 390, 700, 701 e 1440 px**, nenhuma com overflow horizontal (saídas `width320/700/701-test.png` no build local ignorado pelo Git).
- `git diff --check`: aprovado após correção do whitespace do checkpoint.
- `scripts/visual_preview.py` serve somente em 127.0.0.1, **com dados fictícios**; `scripts/visual_capture.py` e `scripts/test_frontend_navigation.py` usam o Edge via CDP para testar e capturar.
- Capturas reproduzíveis de tela: `docs/eventhub-mobile-drawer-open.png`, `docs/eventhub-mobile-catalog.png`, `docs/eventhub-mobile-organizer.png`, `docs/eventhub-mobile-registrations.png`, `docs/eventhub-mobile-updates.png` e `docs/eventhub-desktop-catalog.png`. Em todas, dados de exemplo não são produção.

## Lacunas que NÃO podem ser consideradas concluídas

1. Interfaces e contratos completos de eventos (período, local, descrição, agenda, estados, edição e propriedade por organização) dependem da evolução aprovada do backend Eventos.
2. Check-in, certificados e relatórios continuam serviços **modelados**, não rotas operacionais. Seus fluxos devem ser desenhados/implementados antes da integração final, sem endpoints fictícios apresentados como reais.
3. Administração de perfis/permissões, relatórios de ocupação e operação financeira real precisam de contratos reais e validação de autorização.
4. A paginação visual do histórico continua limitada às primeiras 50 inscrições; o backend aceita `limit/offset`.
5. Teste HTTP E2E com todos os containers, contingência com MySQL fora do ar e integração final do notebook estão **pendentes para a fase final**, por decisão explícita.

## Próxima frente de refinamento no STI

Validar com o usuário as capturas e ajustes de cada tela; modularizar `frontend/src/main.jsx`, melhorar UX de formulário e estados de carregamento, evoluir as telas/contratos faltantes **sem ligar os containers do notebook**. Somente depois executar o empacotamento/integracão final no notebook, preservar resultados e documentar evidência no trabalho arquitetural.

## Evolução de produto no notebook — gestão do organizador (04/11)

**Complemento posterior ao planejamento acima:** a fase de integração no notebook foi autorizada e executada para a versão anterior, no commit `706e3dc`. O texto histórico "sem notebook" acima descreve somente o marco anterior.

**Implementação nova ainda não publicada:** `frontend/src/OrganizerWorkspace.jsx` e `organizer.css` substituem o formulário isolado por uma gestão com lista privada de eventos da organização (inclusive rascunhos), seleção, edição de título/descrição, edição de título de atividade, estado de publicação, sincronização pendente e resumo agregado de ocupação. O frontend usa somente `requestApi` e rotas do Gateway.

**Contratos novos:** `GET /api/me/eventos`, `GET /api/me/eventos/{id}/atividades`, `PATCH /api/me/eventos/{id}`, `PATCH /api/me/atividades/{id}` e `GET /api/me/atividades/{id}/resumo`. Autorização por `role` no Gateway e `org_id` no serviço Eventos. Ocupação é obtida por `Eventos → Inscrições /internal/atividades/{id}/resumo`, **sem acesso cruzado aos schemas SQL**; os números não expõem CPF/titulares. Edição de capacidade **não** é oferecida porque requer coordenação/versionamento entre os dois domínios.

**Validações realizadas no notebook:** `npm run build --prefix frontend` exit 0 (28 módulos); `node --check` para Gateway/Eventos/teste novo, `python -m py_compile` para a API Inscrições e `git diff --check` aprovados. Teste direcionado `python scripts/test_organizer_ui.py` exit 0 com servidor mock isolado e Edge/CDP real: rascunhos, atividades, ocupação, campos e layout sem overflow em 390/1440px. Capturas: `docs/eventhub-organizer-desktop-2026-11-04.png` e `docs/eventhub-organizer-mobile-2026-11-04.png`. Corrigida a limpeza temporária do perfil CDP no Windows.

**Aceite direcionado das APIs reais (04/11):** a reconstrução Docker do `eventhub` principal foi autorizada e concluída no notebook. `scripts/test_organizer_workspace_e2e.js` executou por Gateway/Events/Registrations reais e aprovou `ORGANIZER_WORKSPACE_E2E_OK` (exit 0): lista privada incluindo rascunho, edição de evento e atividade, publicação, resumo após inscrição, bloqueio RBAC de participante e ownership por organização. Cenário registrado: capacidade 3, ocupadas 1, livres 2. O ensaio criou dados sintéticos persistentes na instância principal de desenvolvimento, não foi um teste destrutivo. O visual responsivo foi testado com dados fictícios (Edge/CDP), distinguindo-se do teste HTTP integrado. **Não significa homologação de produção nem teste bancário/SMTP real.**
