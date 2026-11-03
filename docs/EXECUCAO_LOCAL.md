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
