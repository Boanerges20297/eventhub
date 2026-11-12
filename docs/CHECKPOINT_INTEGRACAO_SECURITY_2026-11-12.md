# EventHub — validação integrada de segurança (12/11/2026)

## Escopo e versão exercitada

Validação local do produto acadêmico com **nove containers Docker Compose** do projeto principal `eventhub`, na borda `127.0.0.1:8088`. O código aplicado aos containers foi obtido por integração limpa, em worktree, de `origin/main` no commit `caf5620` e do commit local `eba568c` (listagem paginada de inscrições para organizadores). A integração Git terminou sem conflitos; alterações de trabalho preexistentes foram preservadas. A execução não constitui publicação externa.

Os volumes existentes do MySQL e do SQLite foram reutilizados; nenhum `down -v`, exclusão de volumes ou alteração em outros produtos foi efetuado.

## Falha real identificada e correção

Na primeira reconstrução, Identity não concluiu o startup. O log apresentou `ER_TABLEACCESS_DENIED_ERROR`, impedindo o Gateway e o Caddy de iniciar pela dependência de healthcheck.

**Causa confirmada:** o usuário `eventhub_identity` tinha `SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX`, mas não `REFERENCES` no seu próprio banco `eventhub_identity`. As tabelas novas `sessions`, `otp_challenges` e `trusted_devices` possuem chaves estrangeiras para `users`; MySQL 8.4 exige a permissão `REFERENCES`.

**Correção executada:** `GRANT REFERENCES ON eventhub_identity.* TO 'eventhub_identity'@'%'`, apenas no banco do Identity. Também foi ajustada a concessão correspondente em `infra/mysql/10-service-databases.sh` para novas inicializações. A consulta a `INFORMATION_SCHEMA.SCHEMA_PRIVILEGES` confirmou a permissão, e o Identity reiniciou e alcançou `healthy`. O Gateway e o Caddy foram iniciados; a página respondeu **HTTP 200**.

## Testes integrados de segurança — versão reconstruída

O teste `scripts/test_security_integration_e2e.js` foi executado via Node.js **dentro do container Identity, com requisições HTTP reais ao Gateway e persistência MySQL existente**. O segundo fator foi **simulado exclusivamente em desenvolvimento**. O teste criou dois participantes sintéticos e confirmou a exclusão de ambos na limpeza.

**Resultado observado: `SECURITY_INTEGRATION_E2E_OK checks=12`; saída 0.** Verificações:

1. Rejeição de acesso anônimo a `/auth/me`.
2. Cadastro de dois participantes sintéticos distintos.
3. Senha correta exige segundo fator antes de criar sessão.
4. OTP errado rejeitado; OTP correto aceito apenas uma vez.
5. Sessão válida reconhecida e rota de organizador proibida ao participante.
6. JWT com papel alterado rejeitado, sem escalada para administrador.
7. CSRF obrigatório no logout; sessão revogada não pode ser reutilizada.
8. Cadastro explícito de dispositivo confiável após OTP.
9. Token válido de dispositivo confiável permite login sem novo OTP.
10. Dispositivo revogado deixa de dispensar OTP.
11. Incremento de `auth_version` invalida sessão JWT em uso no Gateway.
12. Três senhas incorretas bloqueiam a conta, inclusive contra senha correta posterior.

**Regressão Node no container:** `node --test security.test.js rate-limit.test.js identity.test.js gateway.test.js` → **8 testes aprovados, zero falhas, exit 0**. O endpoint público anônimo `GET /api/auth/me` respondeu HTTP **401**. Gateway, Identity, Events, Payments, Registrations, Notifications e MySQL apresentaram estado `healthy`; Caddy e worker ficaram em execução. Apenas a porta local 8088 do Caddy permaneceu publicada.

## Testes de negócios e limites

**Antes da reconstrução de segurança**, a versão então existente passou seis roteiros E2E com código 0: `HTTP_E2E_OK`, `ORGANIZER_WORKSPACE_E2E_OK`, `ORGANIZER_REGISTRATIONS_E2E_OK`, `PAYMENTS_E2E_OK`, `NOTIFICATIONS_E2E_OK` e `API_CONCURRENCY_E2E_OK` (40 inscrições, 12 confirmadas e 28 em fila, sem sobreocupação).

**Após a reconstrução**, os sete roteiros convencionais com `Client.login` foram adaptados para realizar senha + verificação OTP de desenvolvimento, sem retirar os controles de segurança; passaram na análise de sintaxe. A tentativa de repetir `test_http_e2e.js` retornou **HTTP 429 LIMITE_DE_REQUISICOES** durante o cadastro sintético, pois o Gateway já havia contabilizado os cadastros recentes do teste anterior no mesmo IP (limite de quatro cadastros por dez minutos). **Não se deve marcar essa regressão como aprovada nem como defeito de regra de negócio.** A reconstrução aprovada do Gateway (para limpar exclusivamente seus limites em memória) foi solicitada ao operador e depende de nova autorização NEXO, ou da expiração natural da janela; os limites não foram desabilitados.

## Revalidação dos fluxos de negócio com OTP e rate limiting ativos

Após a correção do privilégio de chave estrangeira, os nove containers do projeto `eventhub` permaneceram operacionais. O Gateway foi reiniciado de modo controlado e os roteiros existentes foram adaptados ao fluxo de autenticação em duas etapas, preservando CSRF e as regras de autorização.

Resultados observados com execução real no Docker Compose principal, todos com código de saída zero:

| Roteiro | Evidência | Resultado |
|---|---|---|
| `test_http_e2e.js` | `HTTP_E2E_OK`: autenticação, CSRF, RBAC, titularidade, FIFO e promoção | APROVADO |
| `test_payments_e2e.js` | `PAYMENTS_E2E_OK`: aprovação/recusa/indeterminação, idempotência, titularidade | APROVADO |
| `test_notifications_e2e.js` | `NOTIFICATIONS_E2E_OK`: reserva, confirmação, isolamento, deduplicação | APROVADO |
| `test_organizer_workspace_e2e.js` | `ORGANIZER_WORKSPACE_E2E_OK`: rascunho, edição, publicação, ocupação e acesso | APROVADO |
| `test_organizer_registrations_e2e.js` | `ORGANIZER_REGISTRATIONS_E2E_OK`: 4 inscrições, 2 confirmadas, 2 em espera, paginação, filtros, privacidade e negativas de permissão | APROVADO |
| `test_api_concurrency_mfa_e2e.js` | `API_CONCURRENCY_MFA_E2E_OK`: 40 submissões para 12 vagas; 12 confirmadas, 28 em fila; tickets únicos, FIFO, idempotência, isolamento; MySQL auditado; duração de 13,9 s | APROVADO |

**Isolamento dos clientes de teste:** alguns roteiros falharam inicialmente com HTTP 429 porque o Docker reaproveitava IPs de containers temporários dentro da janela de dez minutos (quatro cadastros por IP). O procedimento foi corrigido atribuindo IPs privados exclusivos e distintos aos clientes sintéticos, sem alterar os limites do Gateway, e os roteiros foram reexecutados e aprovados.

**Metodologia da carga de 40 participantes:** 40 identidades e 40 sessões de desenvolvimento foram semeadas diretamente no banco isolado do serviço Identity, usando credenciais de teste e JWTs válidos vinculados a sessões persistidas. Isso elimina somente o cadastro/login em massa do escopo do ensaio, não a revalidação de sessão, CSRF, titularidade nem o fluxo HTTP de inscrição. As 40 solicitações passaram pelo Gateway real, e os 40 estados finais foram auditados diretamente no MySQL/InnoDB de Inscrições. Quatro leituras HTTP amostrais verificaram visibilidade e pertencimento. As sessões sintéticas foram revogadas ao final; os registros de testes foram preservados para auditoria. **Esse cenário não demonstra 40 logins OTP simultâneos**, propriedade distinta da concorrência na concessão de vagas.

**Conclusão da etapa:** seis cenários de negócio da versão atualizada foram aprovados, além das 12 verificações E2E de segurança e oito testes Node. A contingência com desligamento real do MySQL e a falha entre commit e confirmação não foram repetidas nesta etapa; os resultados de contingência de 03/11 permanecem a evidência correspondente. A implantação pública continua fora do escopo experimental.

## Restrições e pendências

- A simulação OTP não representa entrega real por TOTP, e-mail ou SMS e não deve ser ativada em produção pública.
- A borda permanece HTTP local; não foram medidos DDoS volumétrico, WAF, SMTP real ou adquirente financeira.
- O privilégio `REFERENCES` foi corrigido no banco de laboratório e no script de inicialização versionado (commit `0153623`), preservando segregação por banco.
- Os seis principais roteiros de negócio passaram com OTP simulado e rate limiting ativos; os ensaios de contingência destrutiva permanecem evidências históricas não repetidas nesta rodada.
- Evidência de execução deste checkpoint é distinta da homologação para publicação pública.
