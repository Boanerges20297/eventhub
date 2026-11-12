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

Assim, a **autenticação atualizada já possui evidência integrada real de 12 verificações**, mas a reexecução integral dos cenários de negócio com o novo fluxo OTP permanece pendente. As baterias de contingência com desligamento do MySQL não foram repetidas no ambiente principal nesta etapa.

## Restrições e pendências

- A simulação OTP não representa entrega real por TOTP, e-mail ou SMS e não deve ser ativada em produção pública.
- A borda permanece HTTP local; não foram medidos DDoS volumétrico, WAF, SMTP real ou adquirente financeira.
- A correção do privilégio `REFERENCES` deve ser incluída no registro de configuração e no Git.
- Os roteiros regressivos adaptados ao OTP exigem reteste completo sob um orçamento de requisições compatível com o rate limiting.
- Evidência de execução deste checkpoint é distinta da homologação para publicação pública.
