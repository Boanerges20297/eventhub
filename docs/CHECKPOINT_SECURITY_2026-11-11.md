# EventHub — checkpoint de segurança (11/11/2026)

## Escopo concluído no código (STI01)

A implementação é de **homologação local**. Nenhum teste ou deploy de produção foi efetuado.

- **Autenticação:** Argon2 para senha. Login em duas etapas, senha seguida por desafio OTP de seis dígitos criptograficamente aleatórios, com validade de cinco minutos e consumo único.
- **OTP simulado:** só habilitado com `EVENTHUB_OTP_SIMULATION=true` e `NODE_ENV != production`. O navegador mostra o botão **Preencher codigo de teste**; o backend fornece o código válido para o desafio. Não há entrega real por e-mail, SMS ou TOTP. Em produção sem provedor configurado, o acesso sem dispositivo confiável falha fechado com `OTP_CANAL_NAO_CONFIGURADO`.
- **Dispositivo confiável:** escolha explícita após OTP, token aleatório de 256 bits no cookie `HttpOnly; SameSite=Strict`, hash SHA-256 persistido, vínculo à conta, versão de autenticação e hash do User-Agent; prazo de 30 dias; revogação pelo usuário. O User-Agent não é prova criptográfica de dispositivo e pode ser reproduzido, mas o token aleatório continua necessário.
- **Bloqueio temporário:** três credenciais ou códigos incorretos para a mesma conta bloqueiam o login por 15 minutos; o estado persiste no MySQL, e o gateway limita tentativas por IP.
- **Sessões e autorização:** JWT assinado HS256, duração de 30 minutos, `sub` (UUID de usuário), `sid` (UUID de sessão), `role`, `org_id`, `ver` (versão de autenticação), `iss`, `aud`, `iat` e `exp`. Toda rota autenticada revalida a sessão no serviço Identity e confere no banco o ID, a permissão, a organização e a versão. Mudança de role, revogação ou expiração invalida o token anterior.
- **Cookies e requisições:** cookie de sessão `HttpOnly; SameSite=Strict`, CSRF para escrita, bloqueio de Origin cruzada no gateway, respostas de autenticação com `Cache-Control: no-store`. O atributo `Secure` é configurável: `false` apenas para HTTP de desenvolvimento, `true` quando servido sobre HTTPS.
- **Limitação de requisições (por IP, por processo):** 120/min em rotas gerais, 8/min no login, 10/min na verificação OTP, 4 a cada 10 minutos no cadastro, máximo de 100 requisições em voo. A API retorna 429 com `Retry-After` quando ultrapassado. O Caddy sobrescreve `X-Real-IP` com o IP observado na conexão recebida; o gateway interno não é publicado diretamente.
- **Retenção:** tabelas `sessions`, `otp_challenges` e `trusted_devices`, com índices de expiração. Limpeza a cada minuto em lotes de até 1.000 linhas expiradas por tabela. As novas colunas de `users` são adicionadas sem excluir contas existentes.

## Testes executados

No STI01, em `services/node`:

```powershell
node --test security.test.js rate-limit.test.js identity.test.js gateway.test.js
```

**Resultado: 8 testes aprovados, 0 falhas.** Cobrem bloqueio de três tentativas, desbloqueio, OTP inválido/válido/expirado/reutilizado, dispositivo confiável e revogado, sessão revogada e role alterada, tentativas de falsificação JWT, CSRF, Origin e limites por IP.

No frontend, `npm run build`: **sucesso**. `git diff --check`: sem erros de whitespace (apenas avisos Git de conversão LF/CRLF).

## Reforço contra condições de corrida (11/11/2026)

A etapa de concorrência corrigiu um cenário em que uma verificação de senha bem-sucedida podia terminar **depois** da terceira falha concorrente. Antes, a abertura de sessão resetava os contadores sem conferir o bloqueio novamente.

**Implementado no Identity:** atualizações condicionais de falhas (contador limitado a três, sem prolongar bloqueio), transação com `SELECT ... FOR UPDATE` da linha de `users` antes de criar sessão **ou desafio OTP**, rechecagem de `role`, `org_id` e `auth_version`, rechecagem do token de dispositivo confiável durante a transação e impedimento de emitir confiança quando a sessão foi negada. Atualizações de tentativas OTP só contam quando a linha do desafio ainda pode ser alterada.

**Validação controlada:** requisições concorrentes de seis senhas erradas, cinco códigos OTP errados, corrida entre senha correta e terceiro erro, entre OTP correto e terceiro erro, criação de desafio concorrente com bloqueio e revogação de dispositivo durante autenticação. A suíte passou **20 execuções consecutivas** de `node --test identity.test.js` (20/20), além dos **8 testes Node** e `npm run build` (sucesso). Os testes de concorrência usam banco simulado com ordenação forçada; as semânticas reais de transação/índices/isolamento no MySQL InnoDB **ainda precisam de homologação em containers**.

## Pendências antes de homologação completa ou publicação

1. **Integração real com MySQL e Caddy:** não executada. Em 11/11/2026 o STI01 estava sem Docker disponível e o EventHub não tinha arquivo `.env` operacional local. As baterias de identidade/gateway usaram banco e serviços simulados.
2. **OTP real em produção:** selecionar e configurar provedor de envio de segundo fator, códigos de recuperação e fluxo de revogação/reenrolamento. A simulação não é um mecanismo de MFA de produção; nunca expor `simulation_code` em produção.
3. **DDoS volumétrico:** o rate limiting em memória é proteção de camada de aplicação, não defesa contra saturação de rede. Para implantação pública, usar borda/WAF/CDN, limites compartilhados (ex.: Redis) se houver múltiplos gateways, monitoramento/alertas e configuração explícita de proxies confiáveis. Se houver outro proxy antes do Caddy, revisar como recuperar o IP verdadeiro sem confiar em cabeçalhos do cliente.
4. **Validação fim a fim:** verificar testes com containers reais, migração MySQL e fluxos de dois usuários/perfis, mudança de permissão, bloqueio concorrente, revogação, CSRF, expiração e regressão dos demais serviços.
5. **Rotação de chaves e gestão de sessões:** manter segredos fora do Git; implantar política de rotação, auditoria de login e rotina de invalidar dispositivos após mudança sensível de credenciais/role.

## Configuração local

No `.env` criado a partir de `.env.example`, usar:

```dotenv
EVENTHUB_OTP_SIMULATION=true
EVENTHUB_NODE_ENV=development
EVENTHUB_COOKIE_SECURE=false
```

Somente em homologação HTTP local. Para produção: `EVENTHUB_OTP_SIMULATION=false`, `EVENTHUB_NODE_ENV=production`, `EVENTHUB_COOKIE_SECURE=true`, HTTPS e provedor OTP real. A implantação não é segura sem cumprir todos esses itens.

## Arquitetura

Consulte o desenho geral em `docs/ARQUITETURA_COMUNICACAO_SEGURANCA_REDE.md`. Esta nota é o registro de implementação/testes de autenticação; não substitui o documento arquitetural.
