# EventHub — execucao local / apresentacao (versao inicial)

## Maquinas e fonte canonica

- Repositorio privado: `Boanerges20297/eventhub`, branch `main`.
- STI: `C:\Users\STI01\Desktop\Projetos\EventHub` (mesma branch).
- Notebook: `C:\Users\Boanerges\Desktop\Projetos\EventHub` (clone existente).
- O **GitHub main e a base comum**, nunca copiar arquivos manualmente entre maquinas ou sobrescrever arquivos locais para conciliar.
- Antes de atualizar: `git status --short`. Sem alteracoes locais, `git pull --ff-only origin main`. Em caso de divergencia, **parar e conciliar**, sem force push/reset.

## Requisitos

- Docker Desktop rodando com motor Linux; Docker Engine e Compose funcionando.
- Git com acesso ao repositorio privado.
- PowerShell 5.1+ para gerar variaveis, sem salvar segredo no Git.
- Este Compose nao usa o MySQL do XAMPP/STI: usa **MySQL 8.4 em volume Docker isolado** para desenvolvimento/demonstracao.
- Nenhum container do EventHub deve publicar MySQL ou APIs internas. Apenas Caddy em `127.0.0.1:8088`.

## Inicializacao no notebook

Na raiz do repositorio, executar:

```powershell
.\scripts\init-env.ps1
docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
```

**Nao** recriar o arquivo `.env` depois de criar o volume de MySQL; as credenciais existentes precisam corresponder aos usuarios internos.

### Verificacao rapida

```powershell
Invoke-RestMethod http://127.0.0.1:8088/api/health
Invoke-WebRequest http://127.0.0.1:8088/ -UseBasicParsing
docker compose ps
python -m unittest discover -s services/registrations/tests -q
```

A pagina inicial e **tecnica/provisoria**; design visual sera aprovado somente apos o MVP funcional.

## Contrato de desenvolvimento

- 5 microsservicos: `identity`, `events`, `payments` (Fastify), `registrations`, `notifications` (FastAPI).
- `gateway` Fastify central e `caddy` servem o backend e frontend React/Vite.
- `mysql` contem bases logicas e usuarios separados: `eventhub_identity`, `eventhub_events`, `eventhub_payments`, `eventhub_inscricoes`, `eventhub_notifications`; cada usuario recebe apenas acesso ao proprio banco.
- `registrations` usa SQLite persistente separado para tickets; MySQL/InnoDB e a autoridade de ocupacao.
- Outros tres servicos (Check-in, Certificados, Relatorios) sao apenas modelados.
- Os endpoints de saude indicam **infraestrutura ativa**, nao funcionalidade de negocio pronta. Inscricoes reais, pagamento simulado, login JWT e Outbox ainda precisam ser integrados e demonstrados.

## Encerramento seguro

```powershell
docker compose down
```

Sem `-v`: os volumes persistentes ficam preservados. **Nao usar `docker compose down -v` sem autorizacao explicita** — excluiria os dados de demonstracao.

## Resolucao de problemas

- Docker CLI existe mas daemon nao: iniciar Docker Desktop e confirmar `docker version`.
- `docker compose config --quiet` falha por variavel ausente: confirmar somente os nomes das chaves em `.env`; nao imprimir valores.
- Erro de MySQL ao inicializar: `docker compose ps`, `docker compose logs --tail=70 mysql`. Nunca apagar volume para corrigir um erro sem preservar diagnostico.
- Se `8088` ja estiver ocupado, mudar `EVENTHUB_HTTP_PORT` no arquivo privado `.env` para outra porta local.
- Porta 3306 do XAMPP/STI nao conflita com o banco Docker, pois **nenhuma porta MySQL e publicada**.

## Evidencias reais — notebook, 02/11/2026

- `docker compose up -d`: oito containers iniciados; sete servicos com healthcheck `healthy`; Caddy em 127.0.0.1:8088 (HTTP 200).
- `GET /api/health`: HTTP 200 com `implementation=scaffold` e `business_ready=false` (nao declarar MVP pronto).
- MySQL 8.4.13 real via conta `eventhub_registrations@%`; apenas `eventhub_inscricoes`, `information_schema` e `performance_schema` visiveis. Tabelas criadas: `activity_capacity`, `capacity_operations`, `registrations`.
- `python -m unittest discover -s services/registrations/tests -q`: 28 testes aprovados no notebook.
- **Integracao SQLite + MySQL real**: 200 tickets concorrentes para 30 vagas, obtendo 30 `RESERVADO` e 170 `EM_FILA`, com FIFO sequencial; repeticao idempotente e reducao de capacidade 30->29 rejeitada. Caso sintetico: `integration-34de576556ad4cb0` (base isolada; nenhuma base externa alterada).

Para repetir o teste de integracao com uma atividade nova, na raiz do repositorio:

```powershell
Get-Content -Raw .\scripts\test_integration.py | docker compose exec -T registrations python -
```

O teste cria dados sinteticos no MySQL e no SQLite persistentes do EventHub, sem apagar historico. O processamento de tickets no MySQL ainda e chamado explicitamente pelo teste; o **worker automatico**, a promocao de fila, API de inscricoes, JWT, pagamentos simulados, notificacoes e contingencia seguem pendentes.

## Testes que ainda faltam

Promocao FIFO apos liberacao de vaga, garantia de prioridade com worker automatico, concorrencia de concessoes pelo mesmo recurso, queda entre commit MySQL e ACK SQLite, expiracao e recusa, callback atrasado, notificacoes, autorizacao real JWT/CSRF e testes de contingencia. Nao confundir evidencia de infraestrutura com MVP integrado.
Documentar resultados adicionais no relatorio academico somente depois de executados.

## Evidencia do worker (02/11/2026)

O nono container registrations-worker foi inicializado e a prova real MySQL/SQLite
retornou WORKER_INTEGRATION_OK: duas vagas, quatro pedidos, recusa promovendo
ticket 3, cancelamento promovendo ticket 4, expiracao promovendo ticket 5,
reconciliacao e ausencia de overbooking.

## API autenticada em construcao

O codigo de JWT/Argon2id, Gateway com Origin/CSRF/RBAC e API HTTP de eventos
e inscricoes foi preparado. Sua integracao no Docker ainda NAO foi validada.
Apos atualizar o codigo e reconstruir os servicos identity, events, gateway
e registrations, executar o arquivo scripts/test_http_e2e.js dentro do
container identity com: Get-Content -Raw .\scripts\test_http_e2e.js |
docker compose exec -T identity node -

O teste utiliza apenas as credenciais de demonstracao presentes nas
variaveis privadas do container; nao exporta segredos. Usa contas sinteticas.
A configuracao do cookie desativa Secure apenas no loopback HTTP local;
na exposicao HTTPS deve voltar a Secure=true.

## Evidencia HTTP ponta a ponta — notebook (02/11/2026)

Com os nove containers em execucao, o comando de teste do gateway retornou:
HTTP_E2E_OK event=6a71bafe-fa15-4f8b-b8e7-6aa3f081da78
activity=c0d02d2e-35a8-4d55-824b-f912b0700cd9

Verificacoes reais: Argon2id/JWT, CSRF, RBAC, ownership, idempotencia,
criacao de evento/atividade com sincronizacao de capacidade, dois pedidos
RESERVADO e terceiro EM_FILA, cancelamento e promocao automatica do terceiro.

O servico Events falhou na primeira inicializacao por privilegio REFERENCES
faltante no seu banco isolado. Concedido REFERENCES somente a eventhub_events,
sem remover volumes, e corrigido infra/mysql/10-service-databases.sh para
novas instalacoes. Apos a correcao, Eventos, gateway e Caddy ficaram saudaveis.

Pendencias: pagamentos simulados, notificacoes/outbox, contingencia,
validacao visual posterior ao MVP e regras completas de conflito financeiro.
