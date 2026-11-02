# Registro de decisoes arquiteturais — EventHub

**Situacao em 02/11/2026:** itens abaixo aprovados pelo usuario, mas nao implementados nem validados. O plano integral ainda nao foi liberado para implementacao. Estas DA sao registros detalhados; cinco ADRs formais consolidados estao em adrs-formais.md. Contratos propostos em contratos-api.md.

## DA-00 — Stacks principais [APROVADA]
- Frontend: React + Vite.
- Backends: Node.js + Fastify e Python + FastAPI.
- Justificativa: duas tecnologias distintas nos microsservicos, interoperabilidade via contratos, frontend separado.
- **Distribuicao de servicos aprovada:** Identidade, Eventos e Pagamentos em Node.js/Fastify; Inscricoes e Notificacoes em Python/FastAPI. Ver DA-09.

## DA-01 — FIFO de inscricoes, tickets e reserva [APROVADA]
- Prioridade por **ticket sequencial** atribuido pelo servidor, por atividade; timestamp somente para auditoria e rastreio.
- Nao se promete ordenar por horario fisico do clique: a ordem autoritativa e a do aceite no servidor.
- Emissor **unico**, com sequencia persistente no SQLite; deve continuar operando durante falha do MySQL.
- Processamento em ordem de ticket, por atividade. Proteger capacidade por transacao/locks InnoDB; nenhuma confirmacao pode provocar overbooking.
- **RN02 APROVADA (02/11/2026):** prazo de reserva de atividade paga e **configuravel por atividade**, com **padrao de 30 minutos**, contado a partir da concessao da vaga (nao do pedido em fila). O vencimento efetivo e registrado na reserva; nome do campo e limites de configuracao seguem no contrato tecnico a detalhar.
- Ao liberar uma vaga, a fila de espera deve priorizar o proximo ticket elegivel.
- Invariante: pedido registrado nao e vaga concedida; reserva e confirmacao sao estados diferentes.

## DA-02 — Implantacao e recuperacao de containers [APROVADA]
- Containers independentes de microsservicos na **mesma VPS**; rede interna Docker Compose.
- MySQL/InnoDB em container independente e volume persistente; um unico servidor de banco e multiplos bancos logicos/usuarios segregados por servico.
- Servicos de backend, MySQL, SQLite (via volume privado ao emissor) e workers comunicam-se **somente na rede interna Docker**, sem publicacao direta de portas ao exterior. O navegador acessa somente a **borda HTTP(S) controlada** (frontend e roteamento autorizado das APIs); Caddy e gateway Node/Fastify foram aprovados (DA-12/13).
- Watchdog + healthchecks; Docker reinicia processos encerrados, watchdog diagnostica falhas e pode reiniciar containers com limite de **3 tentativas**; persistindo a falha, suspende tentativas e emite alerta.
- Falha isolada em log nao justifica reinicio. MySQL indisponivel: diagnosticar e alertar, **sem reinicio cego**.
- VPS e MySQL unico sao pontos unicos de falha aceitos no prototipo. O fallback local nao protege contra queda integral da VPS.

## DA-03 — Pagamento, recusa e expiracao [APROVADA; REVISAO 02/11/2026]
- Pagamento de atividade paga exige reserva valida; provedor pode ser simulado para a demonstracao.
- O pagamento **efetivamente realizado dentro do prazo** vale mesmo que a confirmacao assincrona chegue depois, com verificacao confiavel antes de qualquer liberacao concorrente.
- **Primeira recusa comprovada e definitiva libera imediatamente a reserva** para o proximo ticket elegivel (RN03 do enunciado). Expiracao definitiva sem pagamento valido tambem libera a reserva. A antiga janela adicional de 10 minutos foi **REVOGADA por decisao expressa**; nao existe segunda tentativa dentro da mesma reserva recusada.
- **Timeout, atraso de callback ou resposta incerta NAO equivalem a recusa.** Nesse caso a reserva permanece EM_VERIFICACAO ate resolver o resultado, preservando DA-04.
- Apos cancelamento, expiracao ou recusa definitivos, participante pode criar nova inscricao com novo ticket no fim da fila, sem prioridade recuperada (DA-14).
- Idempotencia e reconciliacao evitam dupla concessao, callbacks duplicados e confirmacoes indevidas.

## DA-04 — Provedor indisponivel / PIX administrativo [APROVADA]
- Em vencimento com pagamento potencialmente realizado e status indeterminado, a reserva fica EM_VERIFICACAO; sem libera-la automaticamente.
- Tentar reconciliacao automatica intensiva durante **15 minutos** apos detectar expiracao com estado incerto; depois alertar administrador com dados minimos para identificacao, contato, atividade, ticket, valor e historico do incidente.
- Apos 15 min, continuar verificacoes controladas e escalonar, nao prometer desbloqueio automatico em situacao indeterminada.
- Admin pode oferecer **PIX direto/manual** com prazo explicito de **30 minutos** a partir da oferta.
- So confirmar inscricao manual ao **verificar efetivo recebimento**; registrar responsavel, horarios, evidencias e justificativa. Se pagamento original confirmar depois, detectar duplicidade para tratamento/estorno.
- Acesso restrito aos dados do participante e auditoria das acoes administrativas.

## DA-05 — Integracao [APROVADA]
- HTTP/REST entre servicos para consultas e operacoes que exigem retorno imediato.
- Pedidos de inscricao entram em registro duravel, atendidos por worker FIFO.
- **Outbox transacional + worker** para comunicacao assincrona confiavel (especialmente e-mail), com reprocessamento e idempotencia.
- RabbitMQ **nao adotado inicialmente**: seria sobrecarga operacional sem necessidade comprovada para o prototipo.
- Falha em notificacao nao desfaz nem bloqueia uma inscricao confirmada.

## DA-06 — Propriedade dos dados [APROVADA]
- Um MySQL/InnoDB fisico, mas isolamento logico por banco e usuario de cada servico.
- **Sem consulta direta a tabelas de outros servicos**. Integracao por API, eventos e projeccoes.
- Identidade: usuarios, perfis, organizacoes/permissoes.
- Eventos: eventos, atividades, programacao, preco e **capacidade definida**.
- Inscricoes: tickets, estado de inscricao, reservas, ocupacao e fila de espera: **autoridade exclusiva sobre ocupacao**.
- Pagamentos: tentativas, transacoes e respectivos estados.
- Notificacoes: mensagens, entregas e retentativas.
- Reducao da capacidade definida em Eventos precisa coordenar com Inscricoes; nao pode ficar abaixo das vagas comprometidas. Contrato preciso ainda por detalhar.

## DA-07 — SQLite para tickets e contingencia [APROVADA]
- SQLite persistente gerencia emissao unica de tickets e registra pedidos quando MySQL estiver indisponivel.
- Enquanto degradado, **nao conceder ou confirmar vagas**: manter pedido registrado e pendente.
- Apos recuperacao, conciliar em ordem de ticket, transacionalmente no MySQL, com idempotencia e sem sobrescrever ocupacao anterior.
- Remover/arquivar entrada offline somente depois de confirmar commit no MySQL e assegurar que comunicacao do resultado nao sera perdida; falhas intermediarias devem ser reprocessaveis.
- Evitar operacao active-active de concessao entre os bancos. O SQLite e fila/fallback, nao autoridade concorrente sobre vagas.

## DA-08 — Resposta assincrona uniforme ao usuario [APROVADA]
- **Mensagem padrao** tanto no modo normal quanto no degradado, depois do registro duravel do pedido:
  "Sua solicitacao de vaga foi registrada. Assim que processarmos sua inscricao, voce recebera um e-mail com o resultado."
- Exibir ticket e permitir acompanhamento de status.
- **Nao prometer vaga garantida na recepcao do pedido**.
- Para vagas pagas concedidas, avisar de forma clara o vencimento da reserva a partir da concessao; referencia padrao 30 minutos, com configurabilidade a detalhar por RN02.
- Eventuais erros de persistencia devem produzir erro verdadeiro, nunca mensagem falsa de sucesso.

## DA-09 — Decomposicao final e superficie de rede [APROVADA]
- **Oito microsservicos projetados**, com **cinco implementados** e **tres apenas modelados** (sem containers obrigatorios para estes ultimos na demonstracao).
- Implementados, cada qual em **container independente na mesma VPS**:
  1. **Identidade — Node.js/Fastify**: usuarios, autenticacao, organizacoes, perfis e permissoes.
  2. **Eventos e Programacao — Node.js/Fastify**: eventos, atividades, horarios, precos e capacidade definida.
  3. **Inscricoes — Python/FastAPI**: ticket FIFO, reservas, ocupacao, lista de espera e fallback SQLite.
  4. **Pagamentos — Node.js/Fastify**: simulacao de cobrancas, tentativas, recusa, conciliacao e contingencia manual.
  5. **Notificacoes — Python/FastAPI**: recebimento de eventos/solicitacoes de entrega, e-mails e retentativas.
- Apenas modelados: **Check-in**, **Certificados**, **Relatorios**, com responsabilidades e interfaces descritas na arquitetura e no relatorio.
- Frontend **React/Vite** independente dos cinco backends; pode ser servido como bundle estatico na borda HTTP(S).
- **Sem acesso publico direto** aos cinco backends nem ao MySQL/SQLite. A exposicao externa necessaria para usuarios ocorre somente pelo ponto de entrada HTTP(S) controlado, que encaminha operacoes autorizadas pela rede interna Docker. Caddy e gateway/middleware central Node/Fastify foram aprovados posteriormente (DA-12/13).
- Justificativa: separar fronteiras de dominio e tecnologias para demonstrar integracao, independência de implantacao e isolamento, reduzindo o escopo executavel ao fluxo critico em cinco servicos.
- Consequencias: aumento de complexidade de configuracao, contratos, monitoramento e conciliacao; custo aceito e sujeito a testes e a relato critico.

## DA-10 — Alteracao de capacidade com inscricoes assincronas [APROVADA]
- O pedido recebido com ticket, enquanto ainda esta na fila e nao teve reserva concedida, **nao ocupa vaga**.
- Uma reserva ativa, inclusive com pagamento pendente ou pagamento em verificacao, **compromete vaga** da mesma forma que uma inscricao confirmada.
- Eventos e responsavel pela capacidade definida; Inscricoes e a autoridade sobre a ocupacao e a **capacidade operacional aplicada** na concessao das vagas.
- Alteracao de capacidade solicitada por Eventos so pode ser aplicada se o novo limite for **maior ou igual a reservas ativas + inscricoes confirmadas**. A operacao deve ser atomica e coordenada com o worker FIFO, impedindo uma reserva simultanea que use o limite antigo.
- Exemplo: 50 vagas originais e 40 pedidos apenas na fila permitem reduzir para 30. Com 40 vagas ja reservadas/confirmadas, nao permitem reduzir para 30.
- A decisao evita overbooking e preserva a liberdade de corrigir capacidade antes de comprometer vagas.
- **Ainda pendente de desenho:** contrato e ordenacao da mudanca entre Eventos e Inscricoes, versionamento/sincronizacao entre bancos e tratamento de falha no meio do fluxo. Esta aprovacao e da regra, nao da solucao tecnica especifica.

## DA-11 — Identificador e versao para sincronizar alteracoes de capacidade [APROVADA]
- Alteracoes entre Eventos (definicao) e Inscricoes (limite operacional) devem carregar **identificador unico da operacao** e **versao da capacidade por atividade**.
- A mesma operacao pode ser reenviada depois de timeout/crash sem ser aplicada duas vezes (**idempotencia**); versoes obsoletas ou fora de ordem devem ser rejeitadas ou reconciliadas.
- Enquanto nao houver conclusao consistente, a solicitacao de alteracao permanece **PENDENTE**, sem comunicar ao organizador que foi definitivamente concluida.
- Inscricoes continua autoridade para aplicar a capacidade operacional sob transacao, verificando reservas ativas + inscricoes confirmadas e coordenacao com o worker FIFO (DA-10).
- Em caso de falha entre a aplicacao em Inscricoes e a gravacao final em Eventos, o identificador/versao devem permitir consulta do resultado e retomada da mesma operacao, sem uma nova reducao cega.
- **Contrato tecnico a detalhar:** registro duravel de operacoes pendentes em Eventos, resposta de Inscricoes, politica de retry, reconciliacao, versao da capacidade inicial e tratamento de falhas durante a publicacao.

## DA-12 — Caddy como proxy reverso da borda HTTP(S) [APROVADA]
**Contexto:** cinco backends de duas stacks e um frontend React/Vite na mesma VPS; nenhuma API de negocio nem banco deve publicar porta diretamente na internet. Precisa haver uma unica entrada web HTTPS de baixa complexidade operacional para demonstracao em prazo curto.

**Alternativas avaliadas:**
- **Nginx:** maduro e flexivel, mas gerenciamento HTTPS/certificados pode exigir mais configuracao operacional na configuracao escolhida; nao foi adotado.
- **Caddy:** proxy reverso com HTTPS automatico, emissao/renovacao de certificados e redirecionamento HTTP para HTTPS com configuracao reduzida; **selecionado**.
- **Borda customizada em Node ou Python:** possivel, mas adiciona codigo e manutencao sem beneficio arquitetural comprovado para o prototipo.

**Decisao aprovada:**
- Executar Caddy como **container separado**, unica entrada publica HTTP(S) na VPS.
- Servir o build estatico React/Vite e encaminhar /api ao gateway/middleware central Node.js/Fastify, que aplica autenticacao e RBAC e roteia para os microsservicos por DNS interno do Docker Compose (DA-13).
- Somente portas externas estritamente necessarias na borda (tipicamente 80 para validacao/redirecionamento e 443 para HTTPS); **nenhum backend, MySQL, SQLite ou worker com porta publicada**.
- Caddy **nao utiliza nem exige PHP** e nao substitui a autenticacao/autorizacao de Identidade e de cada servico.
- Proteger configuracao, aplicar limites adequados, registrar logs de acesso sem dados sensiveis e manter a imagem atualizada.
- Planejar volume persistente para dados/certificados de Caddy e DNS do dominio apontado para VPS antes de testar certificados publicos.
- A comunicacao interna por HTTP em rede Docker isolada e aceitavel na demonstracao; discutir TLS interno caso as ameacas/ambiente mudem.

**Justificativa principal:** reduzir configuracao de HTTPS e manutencao de certificados, manter superficie de rede publica minima e separar claramente infraestrutura de transporte da logica dos cinco microsservicos. Nao se afirma que Caddy seja isento de vulnerabilidades nem mais seguro por natureza; a reducao de complexidade evita erros de configuracao em um prototipo com prazo curto.

**Custos/trade-offs:** adicionar container e dependencias de DNS, portas 80/443 e armazenamento de certificados; concentrar trafego externo na borda gera ponto unico de entrada; Caddy como reverse proxy **nao e um API Gateway completo** com politica de identidade automatica. Resiliencia do proxy e da VPS continuam limitadas pela infraestrutura unica.

**Fontes tecnicas (consultadas em 02/11/2026):**
- https://caddyserver.com/docs/automatic-https
- https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
- https://caddyserver.com/docs/quick-starts/reverse-proxy

## DA-13 — Autenticacao, RBAC e middleware central Node.js [APROVADA]
- **RBAC (Role-Based Access Control)**: permissao baseada em papel. Papeis minimos: PARTICIPANTE (seus dados/inscricoes), ORGANIZADOR (eventos da propria organizacao) e ADMINISTRADOR (gestao e contingencias).
- Identidade (Node/Fastify) realiza login, protege senhas com hash apropriado (Argon2id) e emite JWT assinado com expiracao curta.
- O frontend utiliza cookie HttpOnly, Secure e SameSite; operacoes que alteram estado precisam de defesa contra CSRF.
- Um **gateway/middleware central de Node.js + Fastify**, como componente tecnico de infraestrutura, recebe as rotas /api encaminhadas pelo Caddy, valida JWT/role e aplica autorizacao de rota (RBAC); encaminha apenas ao destino interno permitido por tabela de rotas fixa. Nao e microsservico de negocio adicional.
- Caddy continua unica porta externa com HTTPS, serve React/Vite e encaminha /api ao gateway Node. Os cinco microsservicos ficam isolados na rede interna Docker.
- **Defesa em profundidade minima:** gateway faz autorizacao geral por rota; cada microsservico ainda valida autorizacao ligada ao proprio recurso e organizacao (ownership/tenant), sem confiar somente na interface ou na filtragem do gateway. Requisicoes diretas nao devem ultrapassar as regras de negocio.
- Segredos nao vao ao Git; funcoes de administrador e dados sensiveis ficam restritos, com trilha de auditoria.
- **Justificativa:** centralizar verificacao repetitiva de identidade e papel, reduzir duplicacao e permitir demonstrar o mesmo contrato entre Node/Fastify e Python/FastAPI. **Custo:** componente extra na rede interna e um ponto de falha adicional, compensados pela simplicidade do codigo comum.
- **Pendente:** detalhes do esquema de claims, renovacao/revogacao de tokens, CSRF, permissoes por endpoint e abordagem exata de validacao de assinatura/identidade nos backends; manter recorte minimo verificavel na demonstracao.

## DA-14 — Idempotencia minima por intencao de negocio [APROVADA]
- Repetir a **mesma intencao** de inscricao ou pagamento nao pode produzir outro ticket, outra reserva ou outra cobranca. Nao adicionar broker ou microsservico extra para isso.
- **Inscricoes:** React cria uma Idempotency-Key (UUID) no primeiro envio e reutiliza em retries da mesma intencao. O emissor SQLite vincula atomicamente chave, usuario, atividade, pedido e ticket unico. Repeticao com mesmo conteudo retorna o mesmo ticket/status; reutilizacao da chave com conteudo diferente gera conflito.
- **Unicidade por CPF + atividade (ajuste solicitado):** solicitar CPF na inscricao, normalizar para somente 11 digitos e validar os digitos verificadores. A combinacao CPF normalizado + activity_id e a chave de negocio: bloquear outra inscricao em estado PENDENTE, EM_FILA, RESERVADO, EM_VERIFICACAO ou CONFIRMADO para essa combinacao, mesmo com chaves de requisicao distintas, por restricao transacional no emissor SQLite e no banco MySQL de Inscricoes. Um mesmo CPF pode participar de atividades diferentes. Se ja existir pedido elegivel, nao emitir novo ticket e nao ocupar outra vaga. Preservar historico. **Reinscricao APROVADA:** apos CANCELAMENTO, EXPIRACAO ou RECUSA definitivos, o mesmo CPF pode solicitar nova inscricao na mesma atividade. A nova intencao recebe nova Idempotency-Key, novo ticket sequencial no fim da fila FIFO, sem reativar ticket antigo e sem garantia de vaga. A unicidade CPF + atividade bloqueia apenas inscricoes ainda ativas; nao bloqueia registros historicos encerrados. A expiração precisa ser definitiva: nunca encerrar como EXPIRADO enquanto houver pagamento em verificacao ou pagamento tempestivo ainda a conciliar (DA-03/04). Validacao matematica do CPF nao comprova titularidade: autenticacao e verificacoes de propriedade continuam obrigatorias; mascarar CPF em logs e respostas de terceiros.
- **Worker/conciliacao:** ticket com unicidade no banco de Inscricoes, transacao de reserva idempotente e recuperacao do fallback sem conceder vaga adicional.
- **Pagamentos:** cada tentativa possui identificador proprio; repeticoes da mesma tentativa nao criam cobrancas extras. Recusa definitiva encerra a reserva na primeira ocorrencia (DA-03 revisada). Eventual novo pedido de inscricao inicia outro ticket e, se receber vaga, uma nova tentativa identificada. Callbacks repetidos sao deduplicados por identificador de evento e transicoes atomicas.
- **Outbox/notificacoes:** identificador unico por evento e deduplicacao de processamento, mantendo retentativas sem alterar o estado da inscricao.
- **Seguranca:** chave idempotente nao substitui autenticacao/autorizacao; nao registrar senhas/tokens em logs.
- **Testes exigidos:** repeticao de POST, duplo clique concorrente, queda na conciliacao SQLite/MySQL, callback replicado 3 vezes, primeira recusa com liberacao e novo pedido ao fim da fila. Verificar ticket unico, ocupacao unica e ausencia de cobranca duplicada.
- **Detalhes pendentes:** politica de retencao de chaves e implementacao da unicidade apenas para inscricoes ativas. A regra de reingresso apos cancelamento/expiracao/recusa definitivos esta APROVADA, sempre com novo ticket ao final da fila.

## DA-15 — Cancelamento pago e reembolso administrativo [APROVADA em 02/11/2026]
- Participante ou administrador autorizado pode solicitar cancelamento. Inscricoes verifica propriedade e estado; em cancelamento seguro e definitivo, marca CANCELADO, libera a vaga UMA vez por transacao e desperta o proximo ticket FIFO elegivel.
- Se a inscricao estiver CONFIRMADA e paga, a vaga e liberada com o cancelamento valido, sem esperar o processamento financeiro do reembolso. O pagamento existente continua registrado no servico Pagamentos.
- **Reembolso de inscricao paga: tratamento administrativo**, sem estorno automatico nem integracao financeira adicional no prototipo. Pagamentos registra solicitacao vinculada a inscricao/transacao e situacao PENDENTE_ANALISE; administrador autorizado analisa conforme politica aplicavel, registra decisao, valor, comprovacao e responsavel. Nao presumir que todo cancelamento gera devolucao integral nem afirmar estorno executado sem evidencia.
- Se pagamento estiver EM_VERIFICACAO, cancelar e apenas uma intencao pendente: nao liberar a vaga nem iniciar estorno ate a conciliacao do resultado financeiro. Depois, resolver o cancelamento de modo idempotente, preservando direitos de pagamento tempestivo.
- Notificacoes informa cancelamento e, separadamente, resultado do pedido de reembolso; falhas de email nao desfazem o cancelamento.
- Cancelamento definitivo permite nova inscricao do mesmo CPF + atividade apenas com novo ticket no fim da fila (DA-14).
- **Limite de escopo:** nao construir motor de reembolsos, carteira financeira, regras comerciais arbitrarias nem sistema financeiro novo. Detalhes dos estados administrativos e politica de elegibilidade continuam propostos para o contrato minimo.

## DA-16 — Lista de espera configuravel por atividade [APROVADA em 02/11/2026]
- `lista_espera_habilitada` e booleana, com padrao **true**. Organizador pode desabilitar antes da abertura.
- Depois de emitir ticket duravel no SQLite, worker FIFO concede vaga se existir; caso contrario, entra EM_FILA quando espera habilitada ou SEM_VAGA quando desabilitada. Espera nao ocupa vaga.
- Cancelamento, recusa ou expiracao definitivos acordam o proximo ticket elegivel.
- No fechamento das inscricoes (nao depois do inicio da atividade), fila remanescente sem vaga encerra como SEM_VAGA, notificada por Outbox.
- Reinscricao apos termino definitivo sempre gera novo ticket no fim da fila (DA-14).

## DA-17 — Sincronizacao tecnica da capacidade [APROVADA em 02/11/2026]
- Nova atividade inicia NAO_PUBLICADA. Eventos persiste operacao PENDENTE para capacidade inicial, versao alvo 1; Inscricoes aplica sob transacao usando operation_id e expected_version=0. Publicacao/inscricao so e liberada apos confirmacao da versao aplicada.
- Mudanca posterior: Eventos registra operation_id, versao alvo e limite desejado como PENDENTE; Inscricoes valida ocupacao comprometida e serializa a alteracao com o worker de concessao na mesma atividade.
- Resultado de operation_id e versao sao persistidos de modo idempotente; retry apos crash obtem o resultado anterior sem reaplicar. Rejeicoes de ocupacao/versao preservam limite antigo.
- Apenas uma alteracao de capacidade pendente por atividade. Limite efetivo aplicado e distinto do pedido pendente; nao anunciar alteracao como concluida antes da confirmacao.
- Sem transacao distribuida nem leitura direta de bancos de outros servicos (DA-06/10/11).

## DA-18 — Contrato minimo JWT, RBAC e CSRF [APROVADA em 02/11/2026]
- Identidade assina JWT com claims minimas `sub`, `role`, `org_id` quando aplicavel, `iss`, `aud`, `iat` e `exp`; nao incluir CPF.
- Sessao web curta: 30 min de validade como padrao para prototipo, sem refresh token; novo login apos expirar. Cookie HttpOnly, Secure e SameSite; segredos/chaves fora do Git.
- Gateway Fastify verifica sessao e papel por rota: 401 sem login e 403 sem permissao, encaminhando apenas a destinos internos fixos. Cada servico valida proprietario/titular/organizacao, nao confiando apenas no gateway.
- Escritas via cookie exigem Origin valido e token CSRF no cabecalho; chamadas internas devem ser autenticadas e nao confiar em identidade fornecida pelo navegador.
- Papeis: PARTICIPANTE (proprios pedidos), ORGANIZADOR (eventos da propria organizacao), ADMINISTRADOR (operacoes autorizadas/contingencia). Eventos publicados podem ser consultados publicamente.
- Detalhes de assinatura, nome de campos e politica de rotacao de chaves ainda devem ser especificados no contrato, sem adicionar novo servico.

## Nota de governanca
A aprovacao deste registro diz respeito ao **planejamento**, nao a autorizacao de codificar, provisionar ou executar o prototipo.
